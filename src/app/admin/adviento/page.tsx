import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin, getStaffProfile } from "@/lib/staff"
import { CAMPANA, PRIMER_DIA, premioPorId, telefonoLindo, clavePorTelefono } from "@/lib/servicios/adviento"
import JugadaRow from "./jugada-row"

/**
 * Quién jugó al Calendario de Adviento, qué le tocó y si ya lo usó.
 *
 * El cartel NUEVA / CLIENTA sale de cruzar el celular con la tabla de
 * clientas: es el número que a Leri le interesa, porque la acción se hizo para
 * traer gente que todavía no vino.
 */

export const dynamic = "force-dynamic"

/** El arranque real de la campaña: medianoche en Argentina (UTC-3). */
const ARRANQUE = PRIMER_DIA + "T03:00:00.000Z"

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

  const COLUMNAS =
    "id, first_name, last_name, phone, phone_key, marketing_consent, door, prize_id, code, redeemed_at, created_at, staff:staff(full_name)"

  let q = admin
    .from("advent_picks")
    .select(COLUMNAS)
    .eq("campaign", CAMPANA)
    .order("created_at", { ascending: false })
    .limit(300)

  if (busqueda) {
    // Filtra la base, no la memoria. El código es la prueba que mira Leri en el
    // mostrador: tiene que encontrarse aunque la jugada sea del 2 de diciembre
    // y haya 900 jugadas más arriba.
    const limpio = busqueda.replace(/[%,()\\*_]/g, " ").trim()
    const digitos = busqueda.replace(/\D/g, "")
    const condiciones = [
      `first_name.ilike.%${limpio}%`,
      `last_name.ilike.%${limpio}%`,
      `code.ilike.%${limpio}%`,
    ]
    if (digitos.length >= 3) condiciones.push(`phone_key.ilike.%${digitos}%`)
    q = q.or(condiciones.join(","))
  }
  if (soloPendientes) q = q.is("redeemed_at", null)

  const { data, error } = await q
  if (error) console.error("[adviento/admin] listado:", error.message)
  const visibles = (data ?? []) as unknown as Fila[]



  // El cruce con clientas. Paginado a propósito: el servidor corta las
  // consultas largas sin avisar, y una clienta que quedara afuera se contaría
  // como NUEVA — que es el número por el que se hizo toda la campaña.
  const telefonosDeClientas = new Set<string>()
  for (let desde = 0; desde < 20_000; ) {
    const { data: pagina, error: errCli } = await admin
      .from("clients")
      .select("phone")
      .order("id")
      .range(desde, desde + 999)
    if (errCli) {
      console.error("[adviento/admin] clientas:", errCli.message)
      break
    }
    const filas = (pagina ?? []) as { phone: string | null }[]
    for (const c of filas) {
      const clave = clavePorTelefono(c.phone)
      if (clave) telefonosDeClientas.add(clave)
    }
    if (filas.length === 0) break
    desde += filas.length
  }

  const esNueva = (f: Fila) => !telefonosDeClientas.has(f.phone_key)
  // Una jugada anterior al 1 de diciembre es una prueba del salón: no cuenta.
  const esPrueba = (f: Fila) => f.created_at < ARRANQUE

  // Los totales se cuentan sobre TODAS las jugadas, no sobre las que entraron
  // en la lista: con 300 jugadas arriba, contar lo visible diría un número
  // menor, y es justo EL número que Leri va a repetir. Son dos columnitas, y
  // se pagina porque el servidor corta las consultas largas sin avisar.
  let jugaron = 0
  let nuevas = 0
  for (let desde = 0; desde < 20_000; ) {
    const { data: pagina, error: errTot } = await admin
      .from("advent_picks")
      .select("phone_key, created_at")
      .eq("campaign", CAMPANA)
      .order("created_at")
      .range(desde, desde + 999)
    if (errTot) {
      console.error("[adviento/admin] totales:", errTot.message)
      break
    }
    const filas = (pagina ?? []) as { phone_key: string; created_at: string }[]
    for (const f of filas) {
      if (f.created_at < ARRANQUE) continue // prueba del salón
      jugaron++
      if (!telefonosDeClientas.has(f.phone_key)) nuevas++
    }
    if (filas.length === 0) break
    desde += filas.length
  }

  return (
    <>
      <p className="adm-eyebrow">Diciembre</p>
      <h1 className="adm-h1">Calendario de Adviento</h1>
      <p className="adm-lede">
        {jugaron === 0
          ? "Todavía no jugó nadie."
          : `${jugaron} ${jugaron === 1 ? "persona jugó" : "personas jugaron"} · ${nuevas} ${
              nuevas === 1 ? "es nueva" : "son nuevas"
            } · ${jugaron - nuevas} ya ${jugaron - nuevas === 1 ? "era clienta" : "eran clientas"}`}
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
          {busqueda || soloPendientes
            ? "Ninguna jugada coincide con eso."
            : "Cuando alguien elija su número, va a aparecer acá."}
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
              prueba={esPrueba(f)}
              telefonoCrudo={f.phone_key}
              nueva={esNueva(f)}
              novedades={f.marketing_consent}
              casillero={f.door}
              premio={premioPorId(f.prize_id)?.texto ?? `Premio ${f.prize_id}`}
              codigo={f.code}
              usadoEl={f.redeemed_at ? fechaCorta(f.redeemed_at) : null}
              usadoPor={f.staff?.full_name ?? null}
              puedeBorrar={esAdmin || !f.redeemed_at}
            />
          ))}
        </div>
      )}
    </>
  )
}
