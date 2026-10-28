import { createClient } from "@supabase/supabase-js"
import { slotsForDate, slotToUtcMs, MIN_ADVANCE_MIN, type BusinessHour } from "@/app/reserva/data"
import { esEmailPlaceholder } from "@/lib/servicios/email-placeholder"
import { overlappingBlock, type BlockedInterval } from "@/lib/servicios/slot-overlap"
import {
  hoyAR,
  rangoDelDiaAR,
  esFechaValida,
  restarDias,
  diasEntre,
  fmtPesos,
  horaAR,
  fechaAR,
  fechaLegible,
  limpiarFiltro,
  limpiarTexto,
  minutosAhoraAR,
  cierreDelDia,
  horariosOfrecibles,
} from "@/lib/servicios/mcp-consultas"
import { fetchDayAvailability } from "@/app/reserva/actions"
import { ErrorParaElAsistente, type McpTool } from "./protocol"

/**
 * Las herramientas que el asistente del salón puede usar. TODAS son de LECTURA:
 * en este archivo no hay un solo `insert`, `update` ni `delete`. Esa es la
 * garantía — aunque el modelo se confunda, acá no hay nada que pueda romper.
 *
 * Devuelven lo MÍNIMO: no sale el DNI, ni las notas internas, ni la ficha
 * médica, ni los puntos. Estos datos viajan a un asistente externo, así que
 * cuanto menos salga, mejor. Las cuentas de fechas y los formatos viven en
 * `@/lib/servicios/mcp-consultas`, que tiene tests.
 *
 * REGLA DE ORO de todo este archivo: una respuesta segura y equivocada es PEOR
 * que un error. Si un dato no se puede saber, se dice que no se puede saber.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Un error de la base NO se le pasa tal cual al asistente externo: los mensajes
 * de PostgREST traen nombres de tablas y columnas. Queda el detalle en el log
 * del servidor y afuera va algo genérico.
 */
function fallaDeBase(contexto: string, error: { message: string }): never {
  console.error("[mcp] " + contexto + ": " + error.message)
  throw new ErrorParaElAsistente("No pude consultar la base en este momento. Probá de nuevo en un rato.")
}

const ESTADO: Record<string, string> = {
  pending: "a confirmar",
  confirmed: "confirmado",
  in_progress: "en curso",
  completed: "completado",
  cancelled: "cancelado",
  no_show: "no vino",
}

/**
 * Los estados que cuentan como "vino". Un confirmado cuya hora ya pasó se
 * muestra "En curso" en el panel pero su estado sigue siendo `confirmed` hasta
 * que alguien aprieta Completar: si sólo se contaran los `completed`, una
 * clienta que vino ayer figuraría como que no viene hace meses y el salón la
 * llamaría para invitarla a volver.
 */
const ESTADOS_VINO = ["completed", "in_progress", "confirmed"]

export function buildTools(): McpTool[] {
  return [
    // ── 1. La agenda de un día ─────────────────────────────────────────────
    {
      name: "agenda_del_dia",
      description:
        "Los turnos de un día: hora, clienta, tratamiento, profesional y estado. Sin fecha, los de hoy. " +
        "Usala para '¿qué tengo mañana?' o '¿cómo viene el jueves?'. Cuando una visita tiene varios " +
        "tratamientos, se listan uno por uno con su hora y su profesional.",
      inputSchema: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha YYYY-MM-DD en hora argentina. Si no se pasa, hoy." },
        },
      },
      run: async (args) => {
        const fecha = args.fecha === undefined ? hoyAR() : args.fecha
        if (!esFechaValida(fecha)) return "La fecha tiene que ser YYYY-MM-DD (por ejemplo 2026-10-28)."
        const { desde, hasta } = rangoDelDiaAR(fecha)
        // Cada PATA trae su hora y su profesional: en una visita compartida, el
        // turno lleva el nombre de UNA sola y atribuirle todo sería mentir
        // (mismo criterio que la agenda del panel).
        const { data, error } = await admin()
          .from("appointments")
          .select(
            "starts_at, duration_min, status, client:clients(first_name, last_name), staff:staff(full_name), " +
            "appointment_services(starts_at, duration_min, service:services(name), staff:staff(full_name))"
          )
          .gte("starts_at", desde)
          .lt("starts_at", hasta)
          .order("starts_at")
        if (error) fallaDeBase("agenda_del_dia", error)

        type Leg = {
          starts_at: string | null
          duration_min: number | null
          service: { name: string } | null
          staff: { full_name: string } | null
        }
        type Row = {
          starts_at: string
          duration_min: number
          status: string
          client: { first_name: string | null; last_name: string | null } | null
          staff: { full_name: string } | null
          appointment_services: Leg[]
        }
        const vivos = ((data ?? []) as unknown as Row[]).filter((r) => r.status !== "cancelled")
        if (!vivos.length) return "No hay turnos el " + fechaLegible(fecha) + "."

        const bloques = vivos.map((r) => {
          const quien = ((r.client?.first_name ?? "") + " " + (r.client?.last_name ?? "")).trim() || "Sin nombre"
          const estado = ESTADO[r.status] ?? r.status
          // Las patas viejas pueden no tener hora propia: van al final y se
          // muestran como "a continuación" en vez de repetir la hora del turno
          // (dos tratamientos a la misma hora se leen como una superposición).
          const legs = [...r.appointment_services].sort((a, b) =>
            (a.starts_at ?? "9999").localeCompare(b.starts_at ?? "9999")
          )

          if (legs.length <= 1) {
            const l = legs[0]
            return (
              horaAR(r.starts_at) +
              " · " + quien +
              " · " + (l?.service?.name ?? "—") +
              " · " + (l?.staff?.full_name ?? r.staff?.full_name ?? "sin asignar") +
              " · " + estado +
              " (" + r.duration_min + " min)"
            )
          }
          const detalle = legs.map((l) =>
            "    " + (l.starts_at ? horaAR(l.starts_at) : "a continuación") +
            " " + (l.service?.name ?? "—") +
            (l.duration_min ? " (" + l.duration_min + " min)" : "") +
            " — " + (l.staff?.full_name ?? r.staff?.full_name ?? "sin asignar")
          )
          return (
            horaAR(r.starts_at) + " · " + quien + " · " + estado +
            " (" + r.duration_min + " min en total)\n" + detalle.join("\n")
          )
        })
        return "Turnos del " + fechaLegible(fecha) + " (" + vivos.length + "):\n" + bloques.join("\n")
      },
    },

    // ── 2. ¿Hay lugar? ─────────────────────────────────────────────────────
    {
      name: "disponibilidad",
      description:
        "Los horarios LIBRES para un tratamiento en una fecha: los que la clienta encuentra en la web, " +
        "más los de hoy que ya entraron en las 2 horas de antelación que pide la web (esos salen marcados: " +
        "la web no los vende, pero el salón los puede cargar a mano). Con una fecha que ya pasó responde " +
        "qué quedó sin ocupar ese día, que es lo que hace falta para cargar a mano un turno que ya se hizo. " +
        "El nombre del tratamiento puede ser parcial.",
      inputSchema: {
        type: "object",
        properties: {
          tratamiento: { type: "string", description: "Nombre (o parte) del tratamiento. Ej: vela slim." },
          fecha: {
            type: "string",
            description:
              "Fecha YYYY-MM-DD en hora argentina. Puede ser pasada: el salón carga turnos que ya se hicieron.",
          },
        },
        required: ["tratamiento", "fecha"],
      },
      run: async (args) => {
        const tratamiento = typeof args.tratamiento === "string" ? limpiarTexto(args.tratamiento) : ""
        const fecha = args.fecha
        if (!tratamiento) return "Decime qué tratamiento."
        if (!esFechaValida(fecha)) return "La fecha tiene que ser YYYY-MM-DD (por ejemplo 2026-10-28)."
        // Una fecha pasada NO se rechaza: el panel agenda en el pasado a
        // propósito (cargar una sesión que ya se hizo), y para eso hay que poder
        // preguntar qué quedó sin ocupar ese día. Lo único que cambia es que no
        // se filtra por hora y que la respuesta aclara qué está contestando.
        const yaPaso = fecha < hoyAR()

        const db = admin()
        const { data: svcs, error: svcErr } = await db
          .from("services")
          .select("id, name, duration_min, pricing_mode, visible_public")
          .ilike("name", "%" + tratamiento + "%")
          .eq("active", true)
          .order("name")
          .limit(10)
        if (svcErr) fallaDeBase("disponibilidad/servicios", svcErr)
        const encontrados = (svcs ?? []) as {
          id: string
          name: string
          duration_min: number
          pricing_mode: string
          visible_public: boolean | null
        }[]
        if (!encontrados.length)
          return 'No encontré ningún tratamiento activo que se parezca a "' + tratamiento + '".'

        // Si el nombre coincide EXACTO, ese gana: con "Vela Slim" y "Vela Slim
        // Premium" cargados, pedir "Vela Slim" no debería ser ambiguo.
        const exacto = encontrados.find((s) => s.name.toLowerCase() === tratamiento.toLowerCase())
        if (!exacto && encontrados.length > 1)
          return (
            "Hay varios tratamientos parecidos: " +
            encontrados.map((s) => s.name).join(", ") +
            ". Decime cuál."
          )
        const svc = exacto ?? encontrados[0]

        if (svc.pricing_mode === "per_zone")
          return (
            '"' + svc.name + '" se cobra por zona y su duración depende de las zonas elegidas: ' +
            "esa disponibilidad hay que mirarla desde el panel."
          )
        if (!svc.duration_min || svc.duration_min < 1)
          return '"' + svc.name + '" no tiene duración cargada.'

        const { data: bh, error: bhErr } = await db
          .from("business_hours")
          .select("day_of_week, is_open, slots")
        // Sin esto, `slotsForDate` cae a un horario de EJEMPLO que no es el del
        // salón y la respuesta saldría confiada y equivocada. Vale igual para el
        // error de la consulta y para la tabla vacía.
        if (bhErr) fallaDeBase("disponibilidad/horarios", bhErr)
        if (!bh || bh.length === 0)
          return "No tengo cargado el horario del salón, así que no puedo decir qué hay libre."

        const delDia = slotsForDate(fecha, bh as BusinessHour[])
        if (!delDia.length) return "El " + fechaLegible(fecha) + " el salón no abre."

        // Las dos reglas (ya pasó / dentro del margen de la web) viven en
        // `horariosOfrecibles`, que tiene tests: era el error más peligroso de
        // esta herramienta y no se puede probar a mano fuera del horario.
        const esHoy = fecha === hoyAR()
        const { candidatos, soloPanel: aMarcar } = horariosOfrecibles({
          slots: delDia,
          duracionMin: svc.duration_min,
          cierreMin: cierreDelDia(delDia),
          ahoraMin: esHoy ? minutosAhoraAR() : null,
          margenMin: MIN_ADVANCE_MIN,
        })
        const soloPanel = new Set(aMarcar)
        if (!candidatos.length)
          return yaPaso
            ? "Ese día no había ningún horario donde entrara " + svc.name + " (" + fechaLegible(fecha) + ")."
            : "Ya no quedan horarios para " + svc.name + " el " + fechaLegible(fecha) + "."

        // Para una fecha PASADA no sirve el buscador de la reserva: ese cuenta
        // como ocupado sólo lo pendiente y lo confirmado, y un turno viejo ya
        // está completado o marcado "no vino" — contestaría que el día entero
        // estuvo libre. Acá se mide contra los turnos que QUEDARON cargados.
        if (yaPaso) {
          const { desde: d0, hasta: d1 } = rangoDelDiaAR(fecha)
          const { data: delDiaAppts, error: apptErr } = await db
            .from("appointments")
            .select(
              "starts_at, duration_min, status, client:clients(first_name, last_name), staff:staff(full_name)"
            )
            .gte("starts_at", d0)
            .lt("starts_at", d1)
            .order("starts_at")
          if (apptErr) fallaDeBase("disponibilidad/pasado", apptErr)
          type ApptPasado = {
            starts_at: string
            duration_min: number | null
            status: string
            client: { first_name: string | null; last_name: string | null } | null
            staff: { full_name: string } | null
          }
          const cargados = ((delDiaAppts ?? []) as unknown as ApptPasado[]).filter(
            (a) => a.status !== "cancelled"
          )
          const ocupado: BlockedInterval[] = cargados.map((a) => {
            const ini = new Date(a.starts_at).getTime()
            return {
              startMs: ini,
              endMs: ini + (a.duration_min ?? 0) * 60_000,
              name: ((a.client?.first_name ?? "") + " " + (a.client?.last_name ?? "")).trim() || "turno",
            }
          })
          const sinNada = candidatos.filter(
            (hm) => !overlappingBlock(slotToUtcMs(fecha, hm), svc.duration_min, ocupado)
          )
          const lineasPasado = [
            svc.name + " (" + svc.duration_min + " min) el " + fechaLegible(fecha) +
              " — esa fecha ya pasó, así que mido contra los turnos que quedaron cargados:",
            sinNada.length
              ? "  Horas sin ningún turno encima: " + sinNada.join(" · ")
              : "  No quedó ninguna hora sin turno encima.",
          ]
          if (cargados.length)
            lineasPasado.push(
              "  Ese día hubo " + cargados.length + " turno(s): " +
              cargados
                .map(
                  (a) =>
                    horaAR(a.starts_at) + " " +
                    (((a.client?.first_name ?? "") + " " + (a.client?.last_name ?? "")).trim() || "sin nombre") +
                    (a.staff?.full_name ? " con " + a.staff.full_name : "") +
                    " (" + (ESTADO[a.status] ?? a.status) + ")"
                )
                .join(", ") + "."
            )
          else lineasPasado.push("  Ese día no hubo ningún turno cargado.")
          if (cargados.length)
            lineasPasado.push(
              "  Ojo: si esos turnos fueron de otra profesional, esa hora igual puede servir. " +
              "La agenda completa del día sale con agenda_del_dia."
            )
          if (svc.visible_public === false)
            lineasPasado.push("  ⚠ Este tratamiento está activo pero NO publicado en la web.")
          return lineasPasado.join("\n")
        }

        const libres = await fetchDayAvailability(fecha, svc.duration_min, "auto", candidatos, {
          serviceId: svc.id,
        })
        if (!libres.length) {
          // Puede ser que esté lleno… o que nadie tenga ese tratamiento asignado.
          // Son cosas muy distintas para el salón.
          const { data: links } = await db.from("staff_services").select("staff_id").eq("service_id", svc.id).limit(1)
          if (!links || links.length === 0)
            return (
              '"' + svc.name + '" no tiene ninguna profesional asignada, así que no se puede reservar. ' +
              "Hay que asignarla en Personal."
            )
          return "No queda lugar para " + svc.name + " el " + fechaLegible(fecha) + "."
        }

        const web = libres.filter((s) => !soloPanel.has(s))
        const aMano = libres.filter((s) => soloPanel.has(s))
        const lineas = [svc.name + " (" + svc.duration_min + " min) el " + fechaLegible(fecha) + ":"]
        lineas.push(web.length ? "  Horarios libres: " + web.join(" · ") : "  En la web ya no queda ninguno.")
        if (aMano.length)
          lineas.push(
            "  Libres pero con menos de 2 h de antelación (la web no los vende; el salón sí los puede " +
            "cargar a mano): " + aMano.join(" · ")
          )
        if (svc.visible_public === false)
          lineas.push("  ⚠ Este tratamiento está activo pero NO publicado en la web: la clienta no lo ve ahí.")
        return lineas.join("\n")
      },
    },

    // ── 3. Buscar una clienta ──────────────────────────────────────────────
    {
      name: "buscar_clienta",
      description:
        "Busca una clienta por nombre, teléfono o email. Si hay varias parecidas devuelve sólo los nombres " +
        "para elegir; con una sola, devuelve su contacto, su próximo turno, cuándo vino por última vez y " +
        "los packs o combos que le quedan por usar.",
      inputSchema: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Nombre, teléfono o email (puede ser parcial)." },
        },
        required: ["texto"],
      },
      run: async (args) => {
        const crudo = typeof args.texto === "string" ? args.texto : ""
        const texto = limpiarFiltro(crudo)
        if (texto.length < 2) return "Decime al menos 2 letras para buscar."

        const db = admin()
        const like = "%" + texto + "%"
        const { data, error } = await db
          .from("clients")
          .select("id, first_name, last_name, phone, email")
          .or(
            "first_name.ilike." + like +
            ",last_name.ilike." + like +
            ",phone.ilike." + like +
            ",email.ilike." + like
          )
          .limit(6)
        if (error) fallaDeBase("buscar_clienta", error)
        type Clienta = {
          id: string
          first_name: string | null
          last_name: string | null
          phone: string | null
          email: string | null
        }
        const clientas = (data ?? []) as Clienta[]

        // "Cecilia Lopez" no coincide con NINGÚN campo suelto (el nombre y el
        // apellido están en columnas distintas), y es justo lo que escribe
        // cualquiera — más todavía cuando este mismo tool devuelve nombres
        // completos para elegir. Si no hubo coincidencias y hay dos palabras, se
        // prueba nombre + apellido en los dos órdenes.
        const palabras = texto.split(" ").filter(Boolean)
        if (!clientas.length && palabras.length >= 2) {
          const uno = palabras[0]
          const resto = palabras.slice(1).join(" ")
          const porPartes = (nombre: string, apellido: string) =>
            db
              .from("clients")
              .select("id, first_name, last_name, phone, email")
              .ilike("first_name", "%" + nombre + "%")
              .ilike("last_name", "%" + apellido + "%")
              .limit(6)
          const [a, b] = await Promise.all([porPartes(uno, resto), porPartes(resto, uno)])
          if (a.error) fallaDeBase("buscar_clienta/partes", a.error)
          if (b.error) fallaDeBase("buscar_clienta/partes", b.error)
          const vistas = new Set<string>()
          for (const c of [...((a.data ?? []) as Clienta[]), ...((b.data ?? []) as Clienta[])])
            if (!vistas.has(c.id)) {
              vistas.add(c.id)
              clientas.push(c)
            }
        }
        if (!clientas.length) return 'No encontré ninguna clienta con "' + texto + '".'

        const nombreDe = (c: { first_name: string | null; last_name: string | null }) =>
          ((c.first_name ?? "") + " " + (c.last_name ?? "")).trim() || "Sin nombre"

        // Con varias coincidencias se devuelven SÓLO los nombres: no hace falta
        // mandarle el teléfono y el email de cinco clientas para encontrar a una.
        if (clientas.length > 1)
          return (
            "Hay varias clientas parecidas: " +
            clientas.map(nombreDe).join(", ") +
            (clientas.length >= 6 ? " (y puede haber más)" : "") +
            ". Decime cuál y te paso sus datos."
          )

        const c = clientas[0]
        const ahora = new Date().toISOString()
        const [proxRes, ultRes, packsRes, combosRes] = await Promise.all([
          db
            .from("appointments")
            .select("starts_at, appointment_services(service:services(name))")
            .eq("client_id", c.id)
            .gte("starts_at", ahora)
            .in("status", ["pending", "confirmed"])
            .order("starts_at")
            .limit(1),
          // "Vino" incluye los turnos que quedaron sin cerrar en el panel (ver
          // ESTADOS_VINO): si no, una visita de ayer sin marcar no existiría.
          db
            .from("appointments")
            .select("starts_at, status")
            .eq("client_id", c.id)
            .in("status", ESTADOS_VINO)
            .lt("starts_at", ahora)
            .order("starts_at", { ascending: false })
            .limit(1),
          db
            .from("pack_purchases")
            .select("pack_name, sessions_total, sessions_used")
            .eq("client_id", c.id),
          db.from("combo_purchases").select("combo_name").eq("client_id", c.id),
        ])
        if (ultRes.error) fallaDeBase("buscar_clienta/ultima", ultRes.error)

        const prox = ((proxRes.data ?? []) as unknown as {
          starts_at: string
          appointment_services: { service: { name: string } | null }[]
        }[])[0]
        const ult = ((ultRes.data ?? []) as { starts_at: string; status: string }[])[0]
        const packsPend = ((packsRes.data ?? []) as {
          pack_name: string
          sessions_total: number
          sessions_used: number
        }[])
          .filter((p) => p.sessions_total - p.sessions_used > 0)
          .map((p) => p.pack_name + " (le quedan " + (p.sessions_total - p.sessions_used) + ")")
        const combos = ((combosRes.data ?? []) as { combo_name: string }[]).map((x) => x.combo_name)

        const lineas: string[] = [
          nombreDe(c) +
            (c.phone ? " · tel " + c.phone : "") +
            (esEmailPlaceholder(c.email) ? "" : " · " + c.email),
          prox
            ? "  Próximo turno: " + fechaAR(prox.starts_at) + " " + horaAR(prox.starts_at) + " — " +
              (prox.appointment_services.map((s) => s.service?.name).filter(Boolean).join(" + ") || "—")
            : "  Próximo turno: no tiene",
          ult
            ? "  Última visita: " + fechaAR(ult.starts_at) +
              (ult.status === "completed" ? "" : " (ese turno quedó sin cerrar en el panel)")
            : "  Última visita: no figura ninguna",
        ]
        if (packsPend.length) lineas.push("  Packs: " + packsPend.join(", "))
        if (combos.length) lineas.push("  Combos comprados: " + combos.join(", "))
        return lineas.join("\n")
      },
    },

    // ── 4. El catálogo ─────────────────────────────────────────────────────
    {
      name: "catalogo",
      description:
        "Los tratamientos activos, con su duración y su precio. Los que no están publicados en la web " +
        "salen marcados. Usala para '¿cuánto sale X?' o '¿cuánto dura Y?'.",
      inputSchema: {
        type: "object",
        properties: { buscar: { type: "string", description: "Opcional: filtra por nombre." } },
      },
      run: async (args) => {
        const db = admin()
        let q = db
          .from("services")
          .select(
            "name, duration_min, price_cents, pricing_mode, visible_public, category:service_categories(name)"
          )
          .eq("active", true)
          .order("name")
        const buscar = typeof args.buscar === "string" ? limpiarTexto(args.buscar) : ""
        if (buscar) q = q.ilike("name", "%" + buscar + "%")
        const { data, error } = await q
        if (error) fallaDeBase("catalogo", error)

        type Row = {
          name: string
          duration_min: number
          price_cents: number
          pricing_mode: string
          visible_public: boolean | null
          category: { name: string } | null
        }
        const rows = (data ?? []) as unknown as Row[]
        if (!rows.length) return "No hay tratamientos que coincidan."

        const porCat = new Map<string, string[]>()
        for (const s of rows) {
          const cat = s.category?.name ?? "Sin categoría"
          const precio =
            s.pricing_mode === "per_zone"
              ? "se cobra por zona (desde " + fmtPesos(s.price_cents) + ")"
              : s.duration_min + " min · " + fmtPesos(s.price_cents)
          const oculto = s.visible_public === false ? " · NO publicado en la web" : ""
          porCat.set(cat, [...(porCat.get(cat) ?? []), s.name + " — " + precio + oculto])
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
        "Cuántos turnos hubo y cuánto se cobró en un período (turnos completados), con el detalle por " +
        "profesional. Sin fechas, los últimos 7 días. Máximo 400 días por consulta. Ojo: no se compara " +
        "con la tarjeta 'Por profesional' del panel, que es de los últimos 12 meses y cuenta visitas, " +
        "no tratamientos.",
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
        if (diasEntre(desde, hasta) > 400)
          return "El período es muy largo: pedime como máximo 400 días por vez."

        const { desde: ini } = rangoDelDiaAR(desde)
        const { hasta: fin } = rangoDelDiaAR(hasta)
        // Por PATA: en un turno compartido cada profesional suma lo suyo, igual
        // que la pantalla de Estadísticas (si no, la que figura en el turno se
        // lleva todo). `count: "exact"` es la única forma honesta de saber si
        // la base devolvió TODO: el tope de filas lo pone el servidor y pedir un
        // `limit` más alto no lo levanta.
        const { data, error, count } = await admin()
          .from("appointments")
          .select("total_cents, status, appointment_services(price_cents, staff:staff(full_name))", {
            count: "exact",
          })
          .gte("starts_at", ini)
          .lt("starts_at", fin)
        if (error) fallaDeBase("resumen", error)

        type Row = {
          total_cents: number
          status: string
          appointment_services: { price_cents: number | null; staff: { full_name: string } | null }[]
        }
        const rows = (data ?? []) as unknown as Row[]
        const completados = rows.filter((r) => r.status === "completed")
        const cobrado = completados.reduce((a, r) => a + (r.total_cents ?? 0), 0)

        const porProfe = new Map<string, { n: number; cents: number }>()
        for (const r of completados) {
          for (const leg of r.appointment_services ?? []) {
            // Una pata sin profesional va a "Sin asignar" en vez de descartarse:
            // así se ve que falta asignar a alguien.
            const k = leg.staff?.full_name ?? "Sin asignar"
            const cur = porProfe.get(k) ?? { n: 0, cents: 0 }
            porProfe.set(k, { n: cur.n + 1, cents: cur.cents + (leg.price_cents ?? 0) })
          }
        }
        // Un turno canjeado con puntos se guarda con total 0 pero la pata
        // conserva el precio de lista: las dos columnas NO tienen por qué dar lo
        // mismo. Hay que decirlo, en vez de dejar dos números peleados.
        const canjes = completados.filter(
          (r) =>
            (r.total_cents ?? 0) === 0 &&
            (r.appointment_services ?? []).some((l) => (l.price_cents ?? 0) > 0)
        ).length

        const lineas = [
          "Del " + desde + " al " + hasta + ":",
          "  Cobrado (turnos completados): " + completados.length + " turnos · " + fmtPesos(cobrado),
          "  Sin completar (a confirmar o confirmados): " +
            rows.filter((r) => r.status === "pending" || r.status === "confirmed").length +
            " · En curso: " + rows.filter((r) => r.status === "in_progress").length +
            " · Cancelados: " + rows.filter((r) => r.status === "cancelled").length +
            " · No vinieron: " + rows.filter((r) => r.status === "no_show").length,
        ]
        if (porProfe.size) {
          lineas.push("  Por profesional (tratamientos hechos, a precio de lista):")
          for (const [k, v] of porProfe)
            lineas.push("    " + k + ": " + v.n + " tratamiento(s) · " + fmtPesos(v.cents))
        }
        if (canjes)
          lineas.push(
            "  ⚠ " + canjes + " turno(s) se canjearon con puntos: suman en el precio de lista de arriba " +
            "pero no entraron como plata, así que esa columna y lo cobrado no coinciden."
          )
        if (count !== null && count > rows.length)
          lineas.push(
            "  ⚠ El período tiene " + count + " turnos y la base me devolvió " + rows.length +
            ": estos totales están incompletos. Pedime un período más corto."
          )
        lineas.push("")
        lineas.push("(Los packs y combos vendidos en el salón se facturan aparte y no entran en esta cuenta.)")
        return lineas.join("\n")
      },
    },

    // ── 6. Las que hace rato no vienen ─────────────────────────────────────
    {
      name: "clientas_sin_venir",
      description:
        "Clientas que no vienen hace mucho (por defecto 60 días), con su teléfono y su última visita, " +
        "de la más antigua a la más reciente. Sirve para invitarlas a volver. Cuenta como visita " +
        "cualquier turno que ya pasó, incluso si quedó sin cerrar en el panel.",
      inputSchema: {
        type: "object",
        properties: {
          dias: { type: "number", description: "Días sin venir (por defecto 60, entre 1 y 3650)." },
          limite: { type: "number", description: "Cuántas listar como máximo (por defecto 20, tope 50)." },
        },
      },
      run: async (args) => {
        const diasPedidos = typeof args.dias === "number" && Number.isFinite(args.dias) ? Math.floor(args.dias) : 60
        const dias = Math.min(Math.max(diasPedidos, 1), 3650)
        const limite =
          typeof args.limite === "number" && Number.isFinite(args.limite)
            ? Math.min(Math.max(Math.floor(args.limite), 1), 50)
            : 20
        const ahora = new Date().toISOString()
        const corte = new Date(Date.now() - dias * 24 * 3_600_000).toISOString()

        const db = admin()
        // La ÚLTIMA visita de cada clienta hay que calcularla sobre TODO el
        // historial: si se mirara sólo un pedazo reciente, las que hace más
        // tiempo que no vienen —justo las que se buscan— quedarían afuera.
        // Se avanza por las filas que REALMENTE llegaron (el tope de filas lo
        // pone el servidor y puede ser menor que la página) y el total sale de
        // `count`, no de adivinar.
        const PAGINA = 1000
        const MAX_PAGINAS = 20
        const ultima = new Map<string, { cuando: string; cerrado: boolean }>()
        let leidas = 0
        let total: number | null = null
        let truncado = false
        for (let p = 0; p < MAX_PAGINAS; p++) {
          const { data, error, count } = await db
            .from("appointments")
            .select("client_id, starts_at, status", { count: "exact" })
            .in("status", ESTADOS_VINO)
            .lt("starts_at", ahora)
            // El segundo criterio evita que dos turnos de la misma hora salgan
            // en distinto orden entre página y página (ahí se saltea una fila).
            .order("starts_at", { ascending: false })
            .order("id")
            .range(leidas, leidas + PAGINA - 1)
          if (error) fallaDeBase("clientas_sin_venir", error)
          const page = (data ?? []) as { client_id: string; starts_at: string; status: string }[]
          // Vienen de más nueva a más vieja: la primera aparición de cada
          // clienta ES su última visita.
          for (const r of page)
            if (!ultima.has(r.client_id))
              ultima.set(r.client_id, { cuando: r.starts_at, cerrado: r.status === "completed" })
          leidas += page.length
          if (count !== null) total = count
          if (page.length === 0) break
          if (total !== null && leidas >= total) break
          if (p === MAX_PAGINAS - 1) truncado = true
        }
        if (total !== null && leidas < total) truncado = true

        const lapsadas = [...ultima.entries()]
          .filter(([, v]) => v.cuando < corte)
          .sort((a, b) => a[1].cuando.localeCompare(b[1].cuando))
          .slice(0, limite)
        if (!lapsadas.length) return "No hay clientas sin venir hace más de " + dias + " días."

        const { data: cli, error: cliErr } = await db
          .from("clients")
          .select("id, first_name, last_name, phone, marketing_consent")
          .in("id", lapsadas.map(([id]) => id))
        if (cliErr) fallaDeBase("clientas_sin_venir/clientes", cliErr)
        const porId = new Map(
          ((cli ?? []) as {
            id: string
            first_name: string | null
            last_name: string | null
            phone: string | null
            marketing_consent: boolean | null
          }[]).map((c) => [c.id, c])
        )

        const lineas = lapsadas.map(([id, v]) => {
          const c = porId.get(id)
          const nombre = ((c?.first_name ?? "") + " " + (c?.last_name ?? "")).trim() || "Sin nombre"
          return (
            nombre +
            (c?.phone ? " · " + c.phone : "") +
            " · última visita " + fechaAR(v.cuando) +
            (v.cerrado ? "" : " (sin cerrar en el panel)") +
            (c?.marketing_consent ? "" : " (no acepta promociones)")
          )
        })
        const aviso = truncado
          ? "\n⚠ Hay más historial del que puedo leer de una: puede faltar alguna clienta muy antigua."
          : ""
        return (
          "Clientas sin venir hace más de " + dias + " días (" + lineas.length + "):\n" +
          lineas.join("\n") + aviso
        )
      },
    },
  ]
}
