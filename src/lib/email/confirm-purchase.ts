import "server-only"
import { Resend } from "resend"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ADDRESS_FULL, MAPS_LINK } from "@/lib/location"
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import {
  FROM,
  SITE,
  shell,
  fmtDateAR,
  escape,
  ctaButtons,
  calChip,
  gcalLink,
} from "./booking-emails"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

type GroupApptRow = {
  id: string
  starts_at: string
  status: string
  pack_purchase_id: string | null
  client_id: string
  appointment_services: {
    starts_at: string | null
    duration_min: number | null
    service: { name: string } | null
    staff: { full_name: string } | null
  }[]
}

/**
 * Mail ÚNICO a la clienta cuando queda confirmado el ÚLTIMO turno pendiente de
 * su compra (todos los turnos que comparten `booking_group_id`). Lee todo de
 * la base, así los distintos caminos que confirman (admin turno por turno,
 * sesiones de pack en lote, canje con puntos) mandan exactamente lo mismo.
 *
 * Anti-duplicado por RECLAMO: marca `confirmation_email_sent_at` ANTES de
 * mandar; el primero que reclama manda, cualquier llamado repetido/concurrente
 * ve 0 filas y se va. Si el envío falla después de reclamar, se des-reclama
 * (best-effort) para que un re-toque del estado pueda reintentar.
 *
 * Best-effort integral: nunca lanza; un mail que falla no rompe la
 * confirmación del turno.
 */
export async function sendGroupConfirmationEmail(
  admin: SupabaseClient,
  bookingGroupId: string
): Promise<void> {
  // Sin Resend configurado no reclamamos nada: un deploy sin la key no debe
  // "quemar" el anti-duplicado del grupo para siempre.
  if (!resend) return

  // 1) Los turnos del grupo (la compra entera, con sus patas).
  const { data } = await admin
    .from("appointments")
    .select(
      `id, starts_at, status, pack_purchase_id, client_id,
       appointment_services(starts_at, duration_min, service:services(name), staff:staff(full_name))`
    )
    .eq("booking_group_id", bookingGroupId)
  const appts = (data ?? []) as unknown as GroupApptRow[]
  if (!appts.length) return

  // 2) Con alguno todavía pendiente no es el último: el mail sale recién
  //    cuando el salón confirma el último turno de la compra.
  if (appts.some((a) => a.status === "pending")) return

  // 3) RECLAMO anti-duplicado.
  const { data: claimed } = await admin
    .from("appointments")
    .update({ confirmation_email_sent_at: new Date().toISOString() })
    .eq("booking_group_id", bookingGroupId)
    .is("confirmation_email_sent_at", null)
    .select("id")
  if (!claimed?.length) return

  // Suelta el reclamo (sólo las filas que ESTE llamado reclamó) para que un
  // re-toque del estado pueda reintentar el envío. Best-effort: si tampoco se
  // puede soltar, el grupo queda como "mandado" y no se duplica nada.
  const unclaim = async () => {
    try {
      await admin
        .from("appointments")
        .update({ confirmation_email_sent_at: null })
        .in(
          "id",
          (claimed as { id: string }[]).map((c) => c.id)
        )
    } catch {
      // best-effort
    }
  }

  try {
    // 4) La clienta: sin email no hay a quién mandarle.
    const { data: clientRow } = await admin
      .from("clients")
      .select("email, first_name")
      .eq("id", appts[0].client_id)
      .single()
    const client = clientRow as { email: string | null; first_name: string | null } | null
    if (!client?.email) {
      await unclaim()
      return
    }

    // 5) Datos del pack (si la compra incluía uno): numera las sesiones por
    //    fecha y avisa cuántas quedan por agendar.
    const packId = appts.find((a) => a.pack_purchase_id)?.pack_purchase_id ?? null
    let packName = ""
    let packRemaining = 0
    const sessionNumber = new Map<string, number>()
    if (packId) {
      const { data: packRow } = await admin
        .from("pack_purchases")
        .select("pack_name, sessions_total")
        .eq("id", packId)
        .single()
      const pack = packRow as { pack_name: string; sessions_total: number } | null
      const sessions = appts
        .filter((a) => a.pack_purchase_id === packId)
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
      sessions.forEach((a, i) => sessionNumber.set(a.id, i + 1))
      packName = pack?.pack_name ?? "Pack"
      packRemaining = Math.max(0, (pack?.sessions_total ?? sessions.length) - sessions.length)
    }

    // 6) El mail muestra SOLO los turnos vivos: uno cancelado/no_show no
    //    viaja. Si no quedó ninguno vivo no hay nada que mandar; soltamos el
    //    reclamo por si más adelante reactivan y re-confirman alguno.
    const live = appts
      .filter((a) => a.status !== "cancelled" && a.status !== "no_show")
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    if (!live.length) {
      await unclaim()
      return
    }

    // Con UN solo turno vivo en total, chip de Google Calendar (con varios no:
    // un solo botón no puede agregar varios eventos). La duración del evento
    // es la ventana real del turno: desde el inicio hasta el fin de la última
    // pata (la grilla puede dejar huecos en el medio).
    let chipHtml = ""
    if (live.length === 1) {
      const only = live[0]
      const legs = only.appointment_services ?? []
      const startsAt = new Date(only.starts_at)
      let endMs = startsAt.getTime()
      for (const l of legs) {
        const legStart = l.starts_at ? new Date(l.starts_at).getTime() : startsAt.getTime()
        endMs = Math.max(endMs, legStart + (l.duration_min ?? 0) * 60_000)
      }
      const durationMin =
        endMs > startsAt.getTime() ? Math.round((endMs - startsAt.getTime()) / 60_000) : 60
      const names = legs
        .map((l) => l.service?.name)
        .filter((n): n is string => Boolean(n))
      const sn = sessionNumber.get(only.id)
      const servicesNames = names.length ? names : sn ? [packName] : ["Tu turno"]
      chipHtml = calChip(gcalLink({ servicesNames, startsAt, durationMin }))
    }

    // Un bloque por turno: la fecha en hora argentina y abajo qué es. Una
    // sesión de pack se etiqueta como tal; con 2+ patas va el itinerario con
    // la hora real de CADA una (la grilla puede dejar huecos y una sola hora
    // engaña). SIN plata: la compra ya está saldada/señada, acá solo se
    // confirma.
    const turnoBlocks = live
      .map((a, idx) => {
        const legs = [...(a.appointment_services ?? [])].sort((x, y) => {
          const tx = x.starts_at ? new Date(x.starts_at).getTime() : 0
          const ty = y.starts_at ? new Date(y.starts_at).getTime() : 0
          return tx - ty
        })
        const sn = sessionNumber.get(a.id)
        let detail: string
        if (sn) {
          detail = `<p style="font-family:Georgia,serif;font-size:15px;margin:0;">Sesión ${sn} · ${escape(packName)}</p>`
        } else if (legs.length > 1) {
          detail = legs
            .filter((l) => l.service?.name)
            .map((l) => {
              const hora = l.starts_at
                ? `<span style="color:#b68a5f;">${arPartsFromUtc(new Date(l.starts_at)).timeStr}</span> `
                : ""
              const min = l.duration_min ? ` · ${l.duration_min} min` : ""
              const prof = l.staff?.full_name ? ` · ${escape(l.staff.full_name)}` : ""
              return `<p style="font-family:Georgia,serif;font-size:15px;margin:0 0 4px;">${hora}${escape(l.service!.name)}<span style="font-size:13px;color:#7a6e64;">${min}${prof}</span></p>`
            })
            .join("")
        } else {
          const l = legs[0]
          const min = l?.duration_min ? ` · ${l.duration_min} min` : ""
          const prof = l?.staff?.full_name ? ` · ${escape(l.staff.full_name)}` : ""
          detail = `<p style="font-family:Georgia,serif;font-size:15px;margin:0;">${escape(l?.service?.name ?? "Tu tratamiento")}<span style="font-size:13px;color:#7a6e64;">${min}${prof}</span></p>`
        }
        const divider =
          idx > 0
            ? `<hr style="border:none;border-top:1px solid rgba(43,38,35,0.1);margin:16px 0;">`
            : ""
        return `${divider}
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:500;margin:0 0 6px;">${fmtDateAR(new Date(a.starts_at))}</p>
      ${detail}
      ${idx === 0 && live.length === 1 ? chipHtml : ""}`
      })
      .join("")

    const packNote =
      packRemaining > 0
        ? `<p style="font-size:13px;color:#7a6e64;margin:12px 0 0;">Te quedan <strong>${packRemaining}</strong> sesión(es) del pack por agendar. Coordinamos con vos para fijarlas.</p>`
        : ""

    const firstName = (client.first_name ?? "").trim()
    const subject =
      live.length === 1
        ? `Tu turno está confirmado · ${fmtDateAR(new Date(live[0].starts_at))}`
        : `Tus turnos están confirmados (${live.length})`

    const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Reserva confirmada</p>
    <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;line-height:1.1;letter-spacing:-0.01em;margin:0 0 16px;">
      Te <em style="color:#b68a5f;">esperamos</em>${firstName ? `, ${escape(firstName)}` : ""}.
    </h1>
    <p style="font-size:15px;line-height:1.6;color:#4a423d;margin:0 0 24px;">
      ${live.length === 1 ? "Tu turno quedó confirmado" : "Tus turnos quedaron confirmados"}. Acá están los detalles:
    </p>
    <div style="background:#fff;border:1px solid rgba(43,38,35,0.1);border-radius:14px;padding:24px;margin-bottom:24px;">
      ${turnoBlocks}
      ${packNote}
      <div style="height:16px;"></div>

      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Dónde</p>
      <p style="font-family:Georgia,serif;font-size:15px;margin:0;">
        By Leri Vendler<br>
        <a href="${MAPS_LINK}" style="font-size:13px;color:#b68a5f;font-family:Helvetica,Arial,sans-serif;text-decoration:underline;">${ADDRESS_FULL}</a>
      </p>
    </div>

    <div style="background:#eae2d7;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#b68a5f;margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;">Recordá</p>
      <p style="font-size:13px;line-height:1.5;color:#4a423d;margin:0;font-family:Helvetica,Arial,sans-serif;">
        Te mandamos un <strong>recordatorio por email 24 horas antes</strong> de cada turno.
        Podés <strong>reprogramar o cancelar sin cargo</strong> hasta 24 horas antes desde tu portal.
      </p>
    </div>

    ${ctaButtons(SITE + "/portal", "Ver mis turnos")}
  `

    // 7) Manda. Resend (v6) no lanza ante un error de API: devuelve { error }.
    //    Falla de cualquier tipo → soltar el reclamo para poder reintentar.
    const { error } = await resend.emails.send({
      from: FROM,
      to: client.email,
      subject,
      html: shell(subject, body),
    })
    if (error) await unclaim()
  } catch {
    await unclaim()
  }
}
