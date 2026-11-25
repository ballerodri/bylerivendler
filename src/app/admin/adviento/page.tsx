import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin, getStaffProfile } from "@/lib/staff"
import { CAMPANA, premioPorId, telefonoLindo } from "@/lib/servicios/adviento"
import JugadaRow from "./jugada-row"

/**
 * Quién jugó al Calendario de Adviento, qué le tocó y si ya lo usó.
 *
 * El cartel NUEVA / CLIENTA sale de cruzar el celular con la tabla de
 * clientas: es el número que a Leri le interesa, porque la acción se hizo para
 * traer gente que todavía no vino.
 */

export const dynamic = "force-dynamic"

type Fila = {
  id: string
  first_name: string
  last_name: string
  phone: string
  phone_key: string
  marketing_consent: boolean
  door: number
  prize_id: number
  code: string
  redeemed_at: string | null
  created_at: string
  staff: { full_name: string } | null
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  })

/** Mismo criterio que el calendario: el celular, comparable entre tablas. */
function claveDeTelefono(raw: string | null): string | null {
  let d = (raw ?? "").replace(/\D/g, "")
  if (!d) return null
  if (d.startsWith("00")) d = d.slice(2)
  if (d.startsWith("54")) d = d.slice(2)
  if (d.length === 11 && d.startsWith("9")) d = d.slice(1)
  if (d.startsWith("0")) d = d.slice(1)
  if (d.length === 12) {
    for (const car of [2, 3, 4]) {
      if (d.slice(car, car + 2) === "15") {
        d = d.slice(0, car) + d.slice(car + 2)
        break
      }
    }
  }
  return d.length === 10 ? "+549" + d : null
}

export default async function AdminAdvientoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pend?: string }>
}) {
  const ssr = await createSsrClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)
  const perfil = user ? await getStaffProfile(user.id) : null
  const esAdmin = perfil?.role === "admin"

  const sp = await searchParams
  const busqueda = (sp.q ?? "").trim()
  const soloPendientes = sp.pend === "1"

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data, error } = await admin
    .from("advent_picks")
    .select(
      "id, first_name, last_name, phone, phone_key, marketing_consent, door, prize_id, code, redeemed_at, created_at, staff:staff(full_name)"
    )
    .eq("campaign", CAMPANA)
    .order("created_at", { ascending: false })
    .limit(1000)

  if (error) console.error("[adviento/admin] listado:", error.message)
  const todas = (data ?? []) as unknown as Fila[]

  // El cruce con clientas: una sola consulta, comparando el celular ya
  // normalizado de las dos puntas.
  const { data: clientas } = await admin.from("clients").select("phone")
  const telefonosDeClientas = new Set(
    ((clientas ?? []) as { phone: string | null }[])
      .map((c) => claveDeTelefono(c.phone))
      .filter((x): x is string => !!x)
  )

  const esNueva = (f: Fila) => !telefonosDeClientas.has(f.phone_key)
  const nuevas = todas.filter(esNueva).length

  const texto = busqueda.toLowerCase()
  const visibles = todas.filter((f) => {
    if (soloPendientes && f.redeemed_at) return false
    if (!texto) return true
    return (
      `${f.first_name} ${f.last_name}`.toLowerCase().includes(texto) ||
      f.phone.toLowerCase().includes(texto) ||
      f.phone_key.includes(texto.replace(/\D/g, "")) ||
      f.code.toLowerCase().includes(texto)
    )
  })

  return (
    <>
      <p className="adm-eyebrow">Diciembre</p>
      <h1 className="adm-h1">Calendario de Adviento</h1>
      <p className="adm-lede">
        {todas.length === 0
          ? "Todavía no jugó nadie."
          : `${todas.length} ${todas.length === 1 ? "persona jugó" : "personas jugaron"} · ${nuevas} ${
              nuevas === 1 ? "es nueva" : "son nuevas"
            } · ${todas.length - nuevas} ya ${todas.length - nuevas === 1 ? "era clienta" : "eran clientas"}`}
      </p>

      <form className="adm-card" method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="adm-input"
          type="search"
          name="q"
          defaultValue={busqueda}
          placeholder="Buscar por nombre, celular o código"
          style={{ flex: "1 1 220px" }}
        />
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" name="pend" value="1" defaultChecked={soloPendientes} />
          Sólo las que falta usar
        </label>
        <button className="adm-btn adm-btn--ghost" type="submit">
          Buscar
        </button>
      </form>

      {visibles.length === 0 ? (
        <p className="adm-empty">
          {todas.length === 0
            ? "Cuando alguien elija su número, va a aparecer acá."
            : "Ninguna jugada coincide con eso."}
        </p>
      ) : (
        <div className="adm-card" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visibles.map((f) => (
            <JugadaRow
              key={f.id}
              id={f.id}
              fecha={fechaCorta(f.created_at)}
              nombre={`${f.first_name} ${f.last_name}`}
              telefono={telefonoLindo(f.phone_key.replace("+549", ""))}
              telefonoCrudo={f.phone_key}
              nueva={esNueva(f)}
              novedades={f.marketing_consent}
              casillero={f.door}
              premio={premioPorId(f.prize_id)?.texto ?? `Premio ${f.prize_id}`}
              codigo={f.code}
              usadoEl={f.redeemed_at ? fechaCorta(f.redeemed_at) : null}
              usadoPor={f.staff?.full_name ?? null}
              puedeBorrar={esAdmin}
            />
          ))}
        </div>
      )}
    </>
  )
}
