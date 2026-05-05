"use client"

import { useState } from "react"
import { sendMagicLink } from "./actions"

const errorMessages: Record<string, string> = {
  invalid_code: "El link expiró o no es válido. Pedí uno nuevo.",
  unknown: "No pudimos completar el ingreso. Probá de nuevo.",
}

export default function LoginForm({
  next,
  initialError,
}: {
  next?: string
  initialError?: string
}) {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(
    initialError ? errorMessages[initialError] ?? errorMessages.unknown : null
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await sendMagicLink({ email, next })
    setSubmitting(false)
    if (result.ok) setSent(true)
    else setError(result.error)
  }

  if (sent) {
    return (
      <div className="magic" style={{ textAlign: "center" }}>
        <p className="eyebrow">Listo</p>
        <h3 className="magic__title">Revisá tu email.</h3>
        <p className="magic__desc">
          Te mandamos un link a <strong>{email}</strong>. Al abrirlo desde tu
          celular, entrás directamente a tu portal.
        </p>
        <button
          className="linkbtn"
          onClick={() => {
            setSent(false)
            setEmail("")
          }}
        >
          Usar otro email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="field__input"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@ejemplo.com"
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "var(--rose-wash)",
            border: "1px solid var(--nude)",
            color: "var(--ink)",
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.4,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <button
        className="btn btn--primary btn--full"
        type="submit"
        disabled={submitting || !email}
      >
        {submitting ? "Enviando…" : "Enviarme el link"}
      </button>
    </form>
  )
}
