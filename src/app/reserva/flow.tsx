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

export default function ReservaFlow({
  categories,
}: {
  categories: Category[]
}) {
  const router = useRouter()
  const variant = useVariant()
  const [step, setStep] = useState(0)
  const [state, setStateRaw] = useState<BookingState>({ services: [] })
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const s = JSON.parse(raw) as BookingState
        // Re-sync selected services against live catalog from DB so any
        // price/duration changes flow through into in-progress bookings.
        if (s.services) {
          const all = categories.flatMap((c) => c.services)
          s.services = s.services
            .map((sel) => all.find((x) => x.id === sel.id))
            .filter((x): x is NonNullable<typeof x> => Boolean(x))
        }
        setStateRaw(s)
      }
      const stepRaw = localStorage.getItem(STEP_KEY)
      if (stepRaw) setStep(parseInt(stepRaw, 10) || 0)
    } catch {}
    setHydrated(true)
  }, [categories])

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
    setState({ services: [] })
    goto(0)
  }

  const handleNext = () => {
    if (step === 2 && state.clientMode === "existing") goto(4)
    else next()
  }
  const handleBack = () => {
    if (step === 4 && state.clientMode === "existing") goto(2)
    else back()
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
        return <Screen1Services {...screenProps} categories={categories} />
      case 1:
        return <Screen2DateTime {...screenProps} />
      case 2:
        return <Screen3Details {...screenProps} />
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
              steps={STEP_LABELS.slice(0, 5)}
              current={Math.min(step, 4)}
              onGo={(i) => goto(i)}
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
