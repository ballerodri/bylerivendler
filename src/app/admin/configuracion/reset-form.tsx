"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { factoryReset } from "../actions"

const CONFIRMATION_WORD = "RESET"

export default function ResetForm() {
  const [input, setInput] = useState("")
  const [step, setStep] = useState<"idle" | "confirming" | "done">("idle")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const confirmed = input.trim() === CONFIRMATION_WORD

  const handleReset = () => {
    setError(null)
    startTransition(async () => {
      const r = await factoryReset()
      if (r.ok) {
        setStep("done")
        setTimeout(() => router.push("/admin"), 2000)
      } else {
        setError(r.error ?? "Error al ejecutar el reset.")
        setStep("idle")
        setInput("")
      }
    })
  }

  if (step === "done") {
    return (
      <p style={{ fontSize: 14, color: "#4d6b3e", fontWeight: 500 }}>
        Reset completado. Redirigiendo...
      </p>
    )
  }

  if (step === "confirming") {
    return (
      <div>
        <p style={{ fontSize: 13, color: "#8c463c", marginBottom: 16, fontWeight: 500 }}>
          Esta acción no se puede deshacer. Para confirmar, escribí <strong>{CONFIRMATION_WORD}</strong> a continuación:
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <input
            className="adm-select"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder={CONFIRMATION_WORD}
            autoFocus
            style={{ fontSize: 14, padding: "8px 12px", width: 160, letterSpacing: "0.1em", fontWeight: 600 }}
          />
          <button
            onClick={handleReset}
            disabled={!confirmed || pending}
            className="adm-btn"
            style={{
              fontSize: 13, padding: "8px 16px",
              background: confirmed ? "#8c463c" : undefined,
              color: confirmed ? "#fff" : undefined,
              borderColor: "#8c463c",
              opacity: !confirmed ? 0.5 : 1,
            }}
          >
            {pending ? "Ejecutando…" : "Ejecutar reset"}
          </button>
          <button
            onClick={() => { setStep("idle"); setInput("") }}
            disabled={pending}
            className="adm-btn"
            style={{ fontSize: 13 }}
          >
            Cancelar
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: "#8c463c" }}>{error}</p>}
      </div>
    )
  }

  return (
    <button
      onClick={() => setStep("confirming")}
      className="adm-btn"
      style={{ fontSize: 13, padding: "8px 16px", color: "#8c463c", borderColor: "#8c463c" }}
    >
      Reset de fábrica
    </button>
  )
}
