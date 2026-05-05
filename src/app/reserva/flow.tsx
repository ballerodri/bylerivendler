"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  SCREEN_LABEL,
  type BookingState,
  type Category,
  type ScreenId,
} from "./data"
import { DesktopSteps } from "./primitives"
import {
  Screen1Services,
  Screen2DateTime,
  Screen3Details,
  Screen4Medical,
  Screen5Confirm,
  Screen6Success,
} from "./screens"
import type { CurrentClient, AuthProfile } from "./queries"

const STORAGE_KEY = "blv_booking"
const STEP_KEY = "blv_step"

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
 * de la persona. La idea: primero la identidad (datos + ficha) si falta algo,
 * después las cuestiones del turno.
 */
function buildScreenOrder(currentClient: CurrentClient | null): ScreenId[] {
  const hasFullData =
    !!currentClient &&
    !!currentClient.firstName &&
    !!currentClient.phone &&
    !!currentClient.dateOfBirth
  const hasRecord = currentClient?.hasMedicalRecord ?? false

  if (hasFullData && hasRecord) {
    return ["services", "date", "confirm", "success"]
  }
  if (hasFullData && !hasRecord) {
    return ["medical", "services", "date", "confirm", "success"]
  }
  return ["details", "medical", "services", "date", "confirm", "success"]
}

export default function ReservaFlow({
  categories,
  currentClient,
  authProfile,
}: {
  categories: Category[]
  currentClient: CurrentClient | null
  authProfile: AuthProfile | null
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
  const totalSteps = screenOrder.length - 1 // exclude "success"

  useEffect(() => {
    let initialState: BookingState = { services: [] }
    try {
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
      const stepRaw = localStorage.getItem(STEP_KEY)
      if (stepRaw) {
        const parsed = parseInt(stepRaw, 10) || 0
        // Saneamos: que el step persistido no exceda los pasos actuales.
        setStep(Math.min(parsed, screenOrder.length - 1))
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

  const next = () => goto(Math.min(screenOrder.length - 1, step + 1))
  const back = () => goto(Math.max(0, step - 1))
  const close = () => router.push("/")
  const restart = () => {
    if (currentClient) {
      setState({
        services: [],
        form: {
          firstName: currentClient.firstName,
          lastName: currentClient.lastName,
          email: currentClient.email,
          phone: currentClient.phone,
          dob: dbDateToUi(currentClient.dateOfBirth),
          consent: true,
        },
        clientMode: "existing",
      })
    } else {
      setState({ services: [] })
    }
    goto(0)
  }

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
            knownFirstName={currentClient?.firstName ?? null}
          />
        )
      case "date":
        return <Screen2DateTime {...screenProps} />
      case "details":
        return (
          <Screen3Details
            {...screenProps}
            isAuthenticated={!!currentClient || !!authProfile}
            authEmail={currentClient?.email ?? authProfile?.email ?? null}
          />
        )
      case "medical":
        return <Screen4Medical {...screenProps} />
      case "confirm":
        return <Screen5Confirm {...screenProps} />
      case "success":
        return (
          <Screen6Success state={state} onClose={close} onRestart={restart} />
        )
      default:
        return null
    }
  }

  // Sidebar de desktop: lista los pasos previos al "success".
  const sidebarSteps = screenOrder
    .filter((id) => id !== "success")
    .map((id) => SCREEN_LABEL[id])
  const sidebarCurrent = Math.min(step, sidebarSteps.length - 1)

  return (
    <div className="blv">
      {variant === "desktop" && screenId !== "success" ? (
        <div className="dlayout">
          <aside className="dside">
            <div className="dside__wordmark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/logo-crop.png" alt="By Leri Vendler" />
            </div>
            <DesktopSteps
              steps={sidebarSteps}
              current={sidebarCurrent}
              onGo={(i) => i <= step && goto(i)}
            />
            <div className="dside__foot">
              <strong>¿Alguna duda?</strong>
              Escribinos por WhatsApp al
              <br />
              +54 9 11 5555-3892
              <br />
              Lun a Sáb · 9 a 20hs
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
