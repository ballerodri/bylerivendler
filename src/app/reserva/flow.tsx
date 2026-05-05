"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { STEP_LABELS, type BookingState, type Category } from "./data"
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

  // Hydrate from localStorage and pre-fill from auth/client when applicable.
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
      if (stepRaw) setStep(parseInt(stepRaw, 10) || 0)
    } catch {}

    // Pre-fill data from the authenticated user. Always overrides any localStorage
    // form to keep things in sync with the actual client record.
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
  }, [categories, currentClient, authProfile])

  const setState = (s: BookingState) => {
    setStateRaw(s)
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }

  const goto = (i: number) => {
    setStep(i)
    if (hydrated) localStorage.setItem(STEP_KEY, String(i))
  }

  const next = () => goto(Math.min(5, step + 1))
  const back = () => goto(Math.max(0, step - 1))
  const close = () => router.push("/")
  const restart = () => {
    // Después de reservar, el cliente queda con ficha; reusamos los datos.
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

  // Conocido (con ficha vigente): saltar pasos 2 (datos) y 3 (ficha).
  const knownClient = !!currentClient && currentClient.hasMedicalRecord

  const handleNext = () => {
    // Después de elegir fecha y hora (paso 1), si ya conocemos todo de la
    // clienta saltamos directo a confirmación (paso 4).
    if (step === 1 && knownClient) {
      goto(4)
      return
    }
    // Si vinieron de "Ya soy clienta" (existing mode), saltamos la ficha.
    if (step === 2 && state.clientMode === "existing") {
      goto(4)
      return
    }
    next()
  }

  const handleBack = () => {
    if (step === 4 && knownClient) {
      goto(1)
      return
    }
    if (step === 4 && state.clientMode === "existing") {
      goto(2)
      return
    }
    back()
  }

  const screenProps = {
    state,
    setState,
    onNext: handleNext,
    onBack: handleBack,
    onClose: close,
    variant,
  }

  const renderScreen = () => {
    switch (step) {
      case 0:
        return (
          <Screen1Services
            {...screenProps}
            categories={categories}
            knownFirstName={currentClient?.firstName ?? null}
          />
        )
      case 1:
        return <Screen2DateTime {...screenProps} />
      case 2:
        return (
          <Screen3Details
            {...screenProps}
            isAuthenticated={!!currentClient || !!authProfile}
            authEmail={currentClient?.email ?? authProfile?.email ?? null}
          />
        )
      case 3:
        return <Screen4Medical {...screenProps} />
      case 4:
        return <Screen5Confirm {...screenProps} />
      case 5:
        return (
          <Screen6Success state={state} onClose={close} onRestart={restart} />
        )
      default:
        return null
    }
  }

  // Pasos visibles en la sidebar de desktop (los saltados se ocultan).
  const sidebarSteps = knownClient
    ? [STEP_LABELS[0], STEP_LABELS[1], STEP_LABELS[4]]
    : STEP_LABELS.slice(0, 5)
  const sidebarCurrent = knownClient
    ? step === 0
      ? 0
      : step === 1
        ? 1
        : 2
    : Math.min(step, 4)

  return (
    <div className="blv">
      {variant === "desktop" && step !== 5 ? (
        <div className="dlayout">
          <aside className="dside">
            <div className="dside__wordmark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/logo-crop.png" alt="By Leri Vendler" />
            </div>
            <DesktopSteps
              steps={sidebarSteps}
              current={sidebarCurrent}
              onGo={() => {}}
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
