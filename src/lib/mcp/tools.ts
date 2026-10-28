import { createClient } from "@supabase/supabase-js"
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { slotsForDate, type BusinessHour } from "@/app/reserva/data"
import { fetchDayAvailability } from "@/app/reserva/actions"
import type { McpTool } from "./protocol"

/**
 * Las herramientas que el asistente de Leri puede usar. TODAS son de LECTURA:
 * en este archivo no hay un solo `insert`, `update` ni `delete`. Esa es la
 * garantía — aunque el modelo se confunda, acá no hay nada que pueda romper.
 *
 * También devuelven lo MÍNIMO necesario: no sale el DNI, ni las notas internas,
 * ni la ficha médica. Estos datos viajan a un asistente externo (ChatGPT), así
 * que cuanto menos salga, mejor.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

const AR_OFFSET_H = 3 // Argentina = UTC-3 (fijo, sin horario de verano)

/** Hoy en Argentina, "YYYY-MM-DD". */
export function hoyAR(now: Date = new Date()): string {
  return arPartsFromUtc(now).dateStr
}

/** "YYYY-MM-DD" → el instante en que arranca y en que termina ese día en Argentina. */
export function rangoDelDiaAR(dateStr: string): { desde: string; hasta: string } {
  const [y, m, d] = dateStr.split("-").map(Number)
  const start = Date.UTC(y, m - 1, d, AR_OFFSET_H, 0, 0)
  return { desde: new Date(start).toISOString(), hasta: new Date(start + 24 * 3_600_000).toISOString() }
}

/** Valida "YYYY-MM-DD" Y que sea una fecha real (no "2026-13-45"). */
export function esFechaValida(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Resta días a una fecha "YYYY-MM-DD" (en hora argentina). */
export function restarDias(dateStr: string, dias: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const ms = Date.UTC(y, m - 1, d, AR_OFFSET_H, 0, 0) - dias * 24 * 3_600_000
  return arPartsFromUtc(new Date(ms)).dateStr
}

const fmtPesos = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("es-AR")
const horaAR = (iso: string) => arPartsFromUtc(new Date(iso)).timeStr
const fechaAR = (iso: string) => arPartsFromUtc(new Date(iso)).dateStr

function fechaLegible(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
}

const ESTADO: Record<string, string> = {
  pending: "a confirmar",
  confirmed: "confirmado",
  in_progress: "en curso",
  completed: "completado",
  cancelled: "cancelado",
  no_show: "no vino",
}

/** El email placeholder de las fichas cargadas a mano no es un email real. */
const esEmailReal = (email: string | null | undefined): boolean =>
  !!email && !email.toLowerCase().endsWith("@noemail.local")

export function buildTools(): McpTool[] {
  return [
    // ── 1. La agenda de un día ─────────────────────────────────────────────
    {
      name: "agenda_del_dia",
      description:
        "Los turnos de un día: hora, clienta, tratamiento, profesional y estado. Sin fecha, los de hoy. " +
        "Usala para preguntas como '¿qué tengo mañana?' o '¿cómo viene el jueves?'.",
      inputSchema: {
        type: "object",
        properties: {
          fecha: {
            type: "string",
            description: "Fecha YYYY-MM-DD en hora argentina. Si no se pasa, hoy.",
          },
        },
      },
      run: async (args) => {
        const fecha = args.fecha === undefined ? hoyAR() : args.fecha
        if (!esFechaValida(fecha)) return "La fecha tiene que ser YYYY-MM-DD (por ejemplo 2026-10-28)."
        const { desde, hasta } = rangoDelDiaAR(fecha)
        const { data, error } = await admin()
          .from("appointments")
          .select(
            "starts_at, duration_min, status, client:clients(first_name, last_name), staff:staff(full_name), appointment_services(service:services(name))"
          )
          .gte("starts_at", desde)
          .lt("starts_at", hasta)
          .order("starts_at")
        if (error) throw new Error(error.message)

        type Row = {
          starts_at: string
          duration_min: number
          status: string
          client: { first_name: string | null; last_name: string | null } | null
          staff: { full_name: string } | null
          appointment_services: { service: { name: string } | null }[]
        }
        const vivos = ((data ?? []) as unknown as Row[]).filter((r) => r.status !== "cancelled")
        if (!vivos.length) return "No hay turnos el " + fechaLegible(fecha) + "."

        const lineas = vivos.map((r) => {
          const quien = (r.client?.first_name ?? "") + " " + (r.client?.last_name ?? "")
          const tratamientos =
            r.appointment_services.map((s) => s.service?.name).filter(Boolean).join(" + ") || "—"
          return (
            horaAR(r.starts_at) +
            " · " + (quien.trim() || "Sin nombre") +
            " · " + tratamientos +
            " · " + (r.staff?.full_name ?? "sin asignar") +
            " · " + (ESTADO[r.status] ?? r.status) +
            " (" + r.duration_min + " min)"
          )
        })
        return "Turnos del " + fechaLegible(fecha) + " (" + vivos.length + "):\n" + lineas.join("\n")
      },
    },

    // ── 2. ¿Hay lugar? ─────────────────────────────────────────────────────
    {
      name: "disponibilidad",
      description:
        "Los horarios LIBRES para un tratamiento en una fecha. Usala para responder '¿tenés lugar el jueves para Vela Slim?'. " +
        "El nombre del tratamiento puede ser parcial.",
      inputSchema: {
        type: "object",
        properties: {
          tratamiento: { type: "string", description: "Nombre (o parte) del tratamiento. Ej: vela slim." },
          fecha: { type: "string", description: "Fecha YYYY-MM-DD en hora argentina." },
        },
        required: ["tratamiento", "fecha"],
      },
      run: async (args) => {
        const tratamiento = typeof args.tratamiento === "string" ? args.tratamiento.trim() : ""
        const fecha = args.fecha
        if (!tratamiento) return "Decime qué tratamiento."
        if (!esFechaValida(fecha)) return "La fecha tiene que ser YYYY-MM-DD (por ejemplo 2026-10-28)."

        const db = admin()
        const { data: svcs, error: svcErr } = await db
          .from("services")
          .select("id, name, duration_min, pricing_mode")
          .ilike("name", "%" + tratamiento + "%")
          .eq("active", true)
          .limit(5)
        if (svcErr) throw new Error(svcErr.message)
        const encontrados = (svcs ?? []) as {
          id: string
          name: string
          duration_min: number
          pricing_mode: string
        }[]
        if (!encontrados.length)
          return 'No encontré ningún tratamiento activo que se parezca a "' + tratamiento + '".'
        if (encontrados.length > 1)
          return (
            "Hay varios tratamientos parecidos: " +
            encontrados.map((s) => s.name).join(", ") +
            ". Decime cuál."
          )

        const svc = encontrados[0]
        if (svc.pricing_mode === "per_zone")
          return (
            '"' + svc.name + '" se cobra por zona y su duración depende de las zonas elegidas: ' +
            "esa disponibilidad hay que mirarla desde el panel."
          )
        if (!svc.duration_min || svc.duration_min < 1)
          return '"' + svc.name + '" no tiene duración cargada.'

        const { data: bh } = await db.from("business_hours").select("day_of_week, is_open, slots")
        const candidatos = slotsForDate(fecha, (bh ?? []) as BusinessHour[])
        if (!candidatos.length) return "El " + fechaLegible(fecha) + " el salón no abre."

        // El MISMO buscador que usa la reserva online: lo que diga acá es lo
        // que la clienta va a encontrar libre en la web.
        const libres = await fetchDayAvailability(fecha, svc.duration_min, "auto", candidatos, {
          serviceId: svc.id,
        })
        if (!libres.length)
          return "No queda lugar para " + svc.name + " el " + fechaLegible(fecha) + "."
        return (
          svc.name + " (" + svc.duration_min + " min) el " + fechaLegible(fecha) +
          " — horarios libres:\n" + libres.join(" · ")
        )
      },
    },

    // ── 3. Buscar una clienta ──────────────────────────────────────────────
    {
      name: "buscar_clienta",
      description:
        "Busca una clienta por nombre, teléfono o email. Devuelve su contacto, su próximo turno, " +
        "cuándo vino por última vez y los packs o combos que le quedan por usar.",
      inputSchema: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Nombre, teléfono o email (puede ser parcial)." },
        },
        required: ["texto"],
      },
      run: async (args) => {
        const texto = typeof args.texto === "string" ? args.texto.trim() : ""
        if (texto.length < 2) return "Decime al menos 2 letras para buscar."
        // Las comas y los paréntesis rompen la sintaxis del filtro `or` de
        // PostgREST: se quitan en vez de arriesgar una consulta inválida.
        const limpio = texto.replace(/[(),]/g, " ").trim()
        if (limpio.length < 2) return "Decime al menos 2 letras para buscar."

        const db = admin()
        const like = "%" + limpio + "%"
        const { data, error } = await db
          .from("clients")
          .select("id, first_name, last_name, phone, email, loyalty_points")
          .or(
            "first_name.ilike." + like +
            ",last_name.ilike." + like +
            ",phone.ilike." + like +
            ",email.ilike." + like
          )
          .limit(5)
        if (error) throw new Error(error.message)
        const clientas = (data ?? []) as {
          id: string
          first_name: string | null
          last_name: string | null
          phone: string | null
          email: string | null
          loyalty_points: number | null
        }[]
        if (!clientas.length) return 'No encontré ninguna clienta con "' + texto + '".'

        const ahora = new Date().toISOString()
        const bloques: string[] = []
        for (const c of clientas) {
          const nombre = ((c.first_name ?? "") + " " + (c.last_name ?? "")).trim() || "Sin nombre"
          const [proxRes, ultRes, packsRes, combosRes] = await Promise.all([
            db
              .from("appointments")
              .select("starts_at, appointment_services(service:services(name))")
              .eq("client_id", c.id)
              .gte("starts_at", ahora)
              .in("status", ["pending", "confirmed"])
              .order("starts_at")
              .limit(1),
            db
              .from("appointments")
              .select("starts_at")
              .eq("client_id", c.id)
              .eq("status", "completed")
              .order("starts_at", { ascending: false })
              .limit(1),
            db
              .from("pack_purchases")
              .select("pack_name, sessions_total, sessions_used")
              .eq("client_id", c.id),
            db.from("combo_purchases").select("combo_name").eq("client_id", c.id),
          ])

          const prox = ((proxRes.data ?? []) as unknown as {
            starts_at: string
            appointment_services: { service: { name: string } | null }[]
          }[])[0]
          const ult = ((ultRes.data ?? []) as { starts_at: string }[])[0]
          const packsPend = ((packsRes.data ?? []) as {
            pack_name: string
            sessions_total: number
            sessions_used: number
          }[])
            .filter((p) => p.sessions_total - p.sessions_used > 0)
            .map((p) => p.pack_name + " (le quedan " + (p.sessions_total - p.sessions_used) + ")")
          const combos = ((combosRes.data ?? []) as { combo_name: string }[]).map((x) => x.combo_name)

          const lineas: string[] = [
            nombre +
              (c.phone ? " · tel " + c.phone : "") +
              (esEmailReal(c.email) ? " · " + c.email : ""),
            prox
              ? "  Próximo turno: " + fechaAR(prox.starts_at) + " " + horaAR(prox.starts_at) + " — " +
                (prox.appointment_services.map((s) => s.service?.name).filter(Boolean).join(" + ") || "—")
              : "  Próximo turno: no tiene",
            ult ? "  Última visita: " + fechaAR(ult.starts_at) : "  Última visita: nunca vino",
          ]
          if (packsPend.length) lineas.push("  Packs: " + packsPend.join(", "))
          if (combos.length) lineas.push("  Combos comprados: " + combos.join(", "))
          if (c.loyalty_points) lineas.push("  Puntos: " + c.loyalty_points)
          bloques.push(lineas.join("\n"))
        }
        return bloques.join("\n\n")
      },
    },

    // ── 4. El catálogo ─────────────────────────────────────────────────────
    {
      name: "catalogo",
      description:
        "Los tratamientos que se pueden reservar, con su duración y su precio. " +
        "Usala para '¿cuánto sale X?' o '¿cuánto dura Y?'.",
      inputSchema: {
        type: "object",
        properties: { buscar: { type: "string", description: "Opcional: filtra por nombre." } },
      },
      run: async (args) => {
        const db = admin()
        let q = db
          .from("services")
          .select("name, duration_min, price_cents, pricing_mode, category:service_categories(name)")
          .eq("active", true)
          .order("name")
        const buscar = typeof args.buscar === "string" ? args.buscar.trim() : ""
        if (buscar) q = q.ilike("name", "%" + buscar + "%")
        const { data, error } = await q
        if (error) throw new Error(error.message)

        type Row = {
          name: string
          duration_min: number
          price_cents: number
          pricing_mode: string
          category: { name: string } | null
        }
        const rows = (data ?? []) as unknown as Row[]
        if (!rows.length) return "No hay tratamientos que coincidan."

        const porCat = new Map<string, string[]>()
        for (const s of rows) {
          const cat = s.category?.name ?? "Sin categoría"
          const detalle =
            s.pricing_mode === "per_zone"
              ? s.name + " — se cobra por zona (desde " + fmtPesos(s.price_cents) + ")"
              : s.name + " — " + s.duration_min + " min · " + fmtPesos(s.price_cents)
          porCat.set(cat, [...(porCat.get(cat) ?? []), detalle])
        }
        return [...porCat.entries()]
          .map(([cat, items]) => cat + ":\n  " + items.join("\n  "))
          .join("\n\n")
      },
    },

    // ── 5. Resumen de un período ───────────────────────────────────────────
    {
      name: "resumen",
      description:
        "Cuántos turnos hubo y cuánto se facturó en un período (turnos completados), con el detalle " +
        "por profesional. Sin fechas, los últimos 7 días.",
      inputSchema: {
        type: "object",
        properties: {
          desde: { type: "string", description: "Fecha YYYY-MM-DD (incluida). Por defecto, 6 días antes del hasta." },
          hasta: { type: "string", description: "Fecha YYYY-MM-DD (incluida). Por defecto, hoy." },
        },
      },
      run: async (args) => {
        const hasta = args.hasta === undefined ? hoyAR() : args.hasta
        if (!esFechaValida(hasta)) return "La fecha 'hasta' tiene que ser YYYY-MM-DD."
        const desde = args.desde === undefined ? restarDias(hasta, 6) : args.desde
        if (!esFechaValida(desde)) return "La fecha 'desde' tiene que ser YYYY-MM-DD."
        if (desde > hasta) return "El 'desde' no puede ser posterior al 'hasta'."

        const { desde: ini } = rangoDelDiaAR(desde)
        const { hasta: fin } = rangoDelDiaAR(hasta)
        const { data, error } = await admin()
          .from("appointments")
          .select("total_cents, status, staff:staff(full_name)")
          .gte("starts_at", ini)
          .lt("starts_at", fin)
        if (error) throw new Error(error.message)

        type Row = { total_cents: number; status: string; staff: { full_name: string } | null }
        const rows = (data ?? []) as unknown as Row[]
        const completados = rows.filter((r) => r.status === "completed")
        const total = completados.reduce((a, r) => a + (r.total_cents ?? 0), 0)

        const porProfe = new Map<string, { n: number; cents: number }>()
        for (const r of completados) {
          const k = r.staff?.full_name ?? "Sin asignar"
          const cur = porProfe.get(k) ?? { n: 0, cents: 0 }
          porProfe.set(k, { n: cur.n + 1, cents: cur.cents + (r.total_cents ?? 0) })
        }

        const lineas = [
          "Del " + desde + " al " + hasta + ":",
          "  Completados: " + completados.length + " · " + fmtPesos(total),
          "  Por venir: " + rows.filter((r) => r.status === "pending" || r.status === "confirmed").length +
            " · Cancelados: " + rows.filter((r) => r.status === "cancelled").length +
            " · No vinieron: " + rows.filter((r) => r.status === "no_show").length,
        ]
        if (porProfe.size) {
          lineas.push("  Por profesional:")
          for (const [k, v] of porProfe) lineas.push("    " + k + ": " + v.n + " turnos · " + fmtPesos(v.cents))
        }
        lineas.push("")
        lineas.push(
          "(El total son los turnos completados. Los packs y combos vendidos en el salón se facturan " +
          "aparte y no entran en esta cuenta.)"
        )
        return lineas.join("\n")
      },
    },

    // ── 6. Las que hace rato no vienen ─────────────────────────────────────
    {
      name: "clientas_sin_venir",
      description:
        "Clientas que no vienen hace mucho (por defecto 60 días), con su teléfono y su última visita. " +
        "Sirve para invitarlas a volver. Sólo lista a las que alguna vez vinieron.",
      inputSchema: {
        type: "object",
        properties: {
          dias: { type: "number", description: "Días sin venir (por defecto 60)." },
          limite: { type: "number", description: "Cuántas listar como máximo (por defecto 20, tope 50)." },
        },
      },
      run: async (args) => {
        const dias = typeof args.dias === "number" && args.dias > 0 ? Math.floor(args.dias) : 60
        const limite =
          typeof args.limite === "number" && args.limite > 0 ? Math.min(Math.floor(args.limite), 50) : 20
        const corte = new Date(Date.now() - dias * 24 * 3_600_000).toISOString()

        const { data, error } = await admin()
          .from("appointments")
          .select("client_id, starts_at, client:clients(first_name, last_name, phone, marketing_consent)")
          .eq("status", "completed")
          .order("starts_at", { ascending: false })
          .limit(2000)
        if (error) throw new Error(error.message)

        type Row = {
          client_id: string
          starts_at: string
          client: {
            first_name: string | null
            last_name: string | null
            phone: string | null
            marketing_consent: boolean | null
          } | null
        }
        const rows = (data ?? []) as unknown as Row[]

        // Vienen ordenados de más nuevo a más viejo: la primera aparición de
        // cada clienta ES su última visita.
        const ultima = new Map<string, Row>()
        for (const r of rows) if (!ultima.has(r.client_id)) ultima.set(r.client_id, r)

        const candidatas = [...ultima.values()]
          .filter((r) => r.starts_at < corte && r.client)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          .slice(0, limite)

        if (!candidatas.length) return "No hay clientas sin venir hace más de " + dias + " días."
        const lineas = candidatas.map((r) => {
          const nombre = ((r.client?.first_name ?? "") + " " + (r.client?.last_name ?? "")).trim() || "Sin nombre"
          return (
            nombre +
            (r.client?.phone ? " · " + r.client.phone : "") +
            " · última visita " + fechaAR(r.starts_at) +
            (r.client?.marketing_consent ? "" : " (no acepta promociones)")
          )
        })
        return (
          "Clientas sin venir hace más de " + dias + " días (" + candidatas.length + "):\n" +
          lineas.join("\n")
        )
      },
    },
  ]
}
