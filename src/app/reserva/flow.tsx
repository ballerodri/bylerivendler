"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  SCREEN_LABEL,
  type BookingState,
  type Category,
  type Combo,
  type Professional,
  type ReservaPack,
  type ScreenId,
} from "./data"
import { DesktopSteps } from "./primitives"
import {
  Screen1Services,
  Screen2DateTime,
  Screen3Details,
  Screen5Confirm,
} from "./screens"
import type { CurrentClient, AuthProfile, BusinessHour } from "./queries"
import type { StaffServiceMap } from "@/lib/servicios/staff-services"
import { whatsappLink, WHATSAPP_DISPLAY } from "@/lib/whatsapp"

const DOW_LABEL = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

function formatHoursSummary(hours: BusinessHour[]): string {
  const open = hours
    .filter(h => h.is_open && h.slots.length > 0)
    .sort((a, b) => a.day_of_week - b.day_of_week)
  if (!open.length) return ""

  const first = open[0].day_of_week
  const last = open[open.length - 1].day_of_week
  const daysStr =
    first === last ? DOW_LABEL[first] : `${DOW_LABEL[first]} a ${DOW_LABEL[last]}`

  const allSlots = open.flatMap(h => h.slots).sort()
  if (!allSlots.length) return daysStr

  const [startH] = allSlots[0].split(":").map(Number)
  const [endH, endM] = allSlots[allSlots.length - 1].split(":").map(Number)
  const closeH = Math.floor((endH * 60 + endM + 30) / 60)

  return `${daysStr} · ${startH} a ${closeH}hs`
}

const STORAGE_KEY = "blv_booking"
const STEP_KEY = "blv_step"
const VERSION_KEY = "blv_flow_version"
// Aumentar este número cuando cambian las pantallas o el orden, para que
// los clientes con estado viejo en localStorage no rompan el render.
// v3: se quitó la ficha médica digital y el consentimiento de depilación del
// flujo (pasan a un formulario en papel); cambia el orden de pantallas.
// v4: se agregó bookingMode/serviceSlots (modo "separados"); un estado viejo
// no tiene esta forma.
// v5: pack y servicios sueltos dejan de ser excluyentes (se pueden comprar
// juntos, con una sola seña); un estado viejo a medias podía quedar en una
// combinación que la pantalla nueva ya no espera.
// v6: el combo pasa a ser PROGRAMA multi-sesión — el `Combo` persistido cambió
// de forma (nuevos `programServices`/`totalSessions`). Un combo guardado con la
// forma vieja no los tiene y rompería el paso de fecha; se descarta.
const FLOW_VERSION = 6

function useVariant(): "mobile" | "desktop" {
  const [variant, setVariant] = useState<"mobile" | "desktop">("mobile")

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)")
    const update = () => setVariant(mq.matches ? "desktop" : "mobile")
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  return variant
}

// "1988-03-22" -> "22/03/1988"
function dbDateToUi(d: string | null): string {
  if (!d) return ""
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
}

/**
 * Decide qué pantallas se muestran y en qué orden, según lo que ya sabemos
 * de la persona. La idea: primero la identidad (datos) si falta algo,
 * después las cuestiones del turno.
 */
function buildScreenOrder(currentClient: CurrentClient | null): ScreenId[] {
  const hasFullData =
    !!currentClient &&
    !!currentClient.firstName &&
    !!currentClient.phone &&
    !!currentClient.dateOfBirth

  if (hasFullData) return ["services", "date", "confirm"]
  return ["details", "services", "date", "confirm"]
}

export default function ReservaFlow({
  categories,
  combos,
  professionals,
  staffServices,
  businessHours,
  currentClient,
  authProfile,
  packs,
}: {
  categories: Category[]
  combos: Combo[]
  professionals: Professional[]
  staffServices: StaffServiceMap
  businessHours: BusinessHour[]
  currentClient: CurrentClient | null
  authProfile: AuthProfile | null
  packs: ReservaPack[]
}) {
  const router = useRouter()
  const variant = useVariant()
  const [step, setStep] = useState(0)
  const [state, setStateRaw] = useState<BookingState>({ services: [] })
  const [hydrated, setHydrated] = useState(false)

  const screenOrder = useMemo(
    () => buildScreenOrder(currentClient),
    [currentClient]
  )
  const totalSteps = screenOrder.length

  useEffect(() => {
    let initialState: BookingState = { services: [] }
    try {
      // Si la versión del flujo cambió, descartamos cualquier estado viejo.
      const persistedVersion = localStorage.getItem(VERSION_KEY)
      if (persistedVersion !== String(FLOW_VERSION)) {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(STEP_KEY)
        localStorage.setItem(VERSION_KEY, String(FLOW_VERSION))
      } else {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const s = JSON.parse(raw) as BookingState
          if (s.services) {
            const all = categories.flatMap((c) => c.services)
            s.services = s.services
              .map((sel) => all.find((x) => x.id === sel.id))
              .filter((x): x is NonNullable<typeof x> => Boolean(x))
          }
          initialState = s
        }

        // Solo restauramos el paso guardado si la clienta NO está en la DB.
        // Si ya tiene perfil completo, el flujo es más corto y arrancamos
        // siempre desde el paso 1 para evitar quedar en "Confirmación".
        if (!currentClient) {
          const stepRaw = localStorage.getItem(STEP_KEY)
          const parsed = stepRaw ? parseInt(stepRaw, 10) || 0 : 0
          const clamped = Math.min(Math.max(0, parsed), screenOrder.length - 1)
          if (stepRaw) setStep(clamped)
        } else {
          localStorage.removeItem(STEP_KEY)
        }
      }
    } catch {}

    if (currentClient) {
      initialState.form = {
        firstName: currentClient.firstName,
        lastName: currentClient.lastName,
        email: currentClient.email,
        phone: currentClient.phone,
        dob: dbDateToUi(currentClient.dateOfBirth),
        consent: true,
      }
      initialState.clientMode = "existing"
    } else if (authProfile) {
      const [first, ...rest] = (authProfile.fullName ?? "").trim().split(/\s+/)
      initialState.form = {
        firstName: first ?? "",
        lastName: rest.join(" "),
        email: authProfile.email,
        phone: initialState.form?.phone ?? "",
        dob: initialState.form?.dob ?? "",
        consent: true,
      }
      initialState.clientMode = "new"
    }

    setStateRaw(initialState)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState)) } catch {}
    setHydrated(true)
  }, [categories, currentClient, authProfile, screenOrder])

  const setState = (s: BookingState) => {
    setStateRaw(s)
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }

  const goto = (i: number) => {
    setStep(i)
    if (hydrated) localStorage.setItem(STEP_KEY, String(i))
  }

  // Scroll al inicio en cada cambio de paso. Sin esto, al volver de la
  // pantalla de éxito (que es alta), la persona aparece scrolleada al final
  // y ve la página "en blanco".
  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0)
  }, [step])

  // ── Blindaje bfcache: no re-mostrar "Confirmar y pagar" tras pagar ─────────
  // `pay()` limpia el estado persistido y navega a /reserva/exito. Si la
  // clienta vuelve con "atrás" y el navegador restaura esta página desde el
  // bfcache (memoria, sin recargar), el estado de React revive con la compra
  // YA PAGADA en pantalla y el botón de pagar vivo → podría pagar dos veces.
  // Señal inequívoca: página restaurada (e.persisted) SIN estado persistido
  // (pay() lo borró — la hidratación normal siempre lo escribe). Se recarga:
  // el asistente arranca limpio.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      try {
        if (!localStorage.getItem(STORAGE_KEY)) window.location.reload()
      } catch {}
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])

  // ── El botón "atrás" del teléfono/navegador retrocede UN PASO ─────────────
  // Los pasos del asistente son estado interno de React: sin esto, el "atrás"
  // del navegador se va de /reserva entera y la clienta pierde el asistente
  // ("se me cerró"). Cada paso recorrido se registra en el historial
  // (`blvStep`); "atrás" dispara `popstate` y volvemos ese paso. En el paso 1
  // no hay entrada previa del asistente, así que "atrás" sale de la página
  // (comportamiento normal).
  const stepRef = useRef(step)
  useEffect(() => { stepRef.current = step }, [step])
  // Traba de retroceso: `history.back()/go()` son ASÍNCRONOS — el popstate (y
  // el cambio de paso) llegan después. Un segundo toque rápido en "← Atrás"
  // leería el paso viejo, pasaría la guarda y encolaría OTRO retroceso: dos
  // pasos de una, y desde el paso 1 se iría de /reserva (el bug original de
  // nuevo). Se traba hasta que el popstate resuelve.
  const travelingRef = useRef(false)
  useEffect(() => {
    if (!hydrated) return
    // Si la entrada actual YA trae paso (`blvStep`) — recarga a mitad del
    // asistente, o volver a /reserva desde otra página — se ADOPTA ese paso en
    // vez de reconstruir: reconstruir de nuevo duplicaría las entradas viejas
    // que quedaron detrás y "atrás" rebotaría entre pasos en vez de salir.
    const existing = (window.history.state as { blvStep?: number } | null)?.blvStep
    if (typeof existing === "number") {
      const clamped = Math.min(Math.max(0, existing), screenOrder.length - 1)
      // Adopción deliberada del estado del historial (sistema externo) al
      // montar: corre una sola vez, no cascadea.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep(clamped)
      try { localStorage.setItem(STEP_KEY, String(clamped)) } catch {}
    } else {
      // Primera vez en esta entrada: una entrada del historial por paso ya
      // recorrido (tras restaurar de localStorage puede NO ser el primero).
      window.history.replaceState({ blvStep: 0 }, "")
      for (let k = 1; k <= stepRef.current; k++) window.history.pushState({ blvStep: k }, "")
    }

    const onPop = (e: PopStateEvent) => {
      travelingRef.current = false // la traba se suelta al resolver el viaje
      const s = (e.state as { blvStep?: number } | null)?.blvStep
      if (typeof s !== "number") return // salió del asistente (u otra entrada)
      const clamped = Math.min(Math.max(0, s), screenOrder.length - 1)
      setStep(clamped)
      try { localStorage.setItem(STEP_KEY, String(clamped)) } catch {}
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // Retrocede `delta` pasos VIA el historial (popstate hace el setStep). La
  // traba evita el doble toque; el timeout es la red de seguridad por si un
  // navegador traga el traversal y el popstate nunca llega (botón muerto si no).
  const travel = (delta: number) => {
    if (delta >= 0 || travelingRef.current) return
    travelingRef.current = true
    window.setTimeout(() => { travelingRef.current = false }, 700)
    window.history.go(delta)
  }

  const next = () => {
    const i = Math.min(screenOrder.length - 1, step + 1)
    if (i === step) return
    goto(i)
    window.history.pushState({ blvStep: i }, "")
  }
  // El "← Atrás" de la app usa el MISMO mecanismo que el botón del teléfono
  // (history.back → popstate → retrocede un paso): un solo camino, nunca
  // desincronizados.
  const back = () => { if (step > 0) travel(-1) }
  const close = () => router.push("/")

  const screenId = screenOrder[step]
  const stepNumber = step + 1

  const screenProps = {
    state,
    setState,
    onNext: next,
    onBack: back,
    onClose: close,
    variant,
    stepNumber,
    totalSteps,
  }

  const renderScreen = () => {
    switch (screenId) {
      case "services":
        return (
          <Screen1Services
            {...screenProps}
            categories={categories}
            combos={combos}
            packs={packs}
            knownFirstName={currentClient?.firstName ?? null}
          />
        )
      case "date":
        return (
          <Screen2DateTime
            {...screenProps}
            professionals={professionals}
            staffServices={staffServices}
            businessHours={businessHours}
          />
        )
      case "details":
        return (
          <Screen3Details
            {...screenProps}
            isAuthenticated={!!currentClient || !!authProfile}
            authEmail={currentClient?.email ?? authProfile?.email ?? null}
          />
        )
      case "confirm":
        return (
          <Screen5Confirm
            {...screenProps}
            loyaltyPoints={currentClient?.loyaltyPoints ?? 0}
            professionals={professionals}
            packs={packs}
            businessHours={businessHours}
          />
        )
      default:
        return null
    }
  }

  const sidebarSteps = screenOrder.map((id) => SCREEN_LABEL[id])
  const sidebarCurrent = Math.min(step, sidebarSteps.length - 1)

  return (
    <div className="blv">
      {variant === "desktop" ? (
        <div className="dlayout">
          <aside className="dside">
            <div className="dside__wordmark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/logo-crop.png" alt="By Leri Vendler" />
            </div>
            <DesktopSteps
              steps={sidebarSteps}
              current={sidebarCurrent}
              // Saltar hacia atrás via el historial (history.go → popstate):
              // mismo camino que el botón "atrás", el stack nunca se desincroniza.
              onGo={(i) => { if (i < step) travel(i - step) }}
            />
            <div className="dside__foot">
              <strong>¿Alguna duda?</strong>
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Escribinos por WhatsApp
              </a>
              <br />
              {WHATSAPP_DISPLAY}
              {formatHoursSummary(businessHours) && (
                <>
                  <br />
                  {formatHoursSummary(businessHours)}
                </>
              )}
            </div>
          </aside>
          {renderScreen()}
        </div>
      ) : (
        renderScreen()
      )}
    </div>
  )
}
