"use client"

import { useState } from "react"
import { sendMagicLink, signInWithGoogle } from "./actions"

const errorMessages: Record<string, string> = {
  invalid_code: "El link expiró o no es válido. Pedí uno nuevo.",
  unknown: "No pudimos completar el ingreso. Probá de nuevo.",
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M17.6 9.2c0-.6 0-1.2-.1-1.7H9v3.3h4.8c-.2 1.1-.8 2-1.7 2.6v2.2h2.7c1.6-1.5 2.5-3.7 2.5-6.4z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.3 0 4.2-.8 5.6-2.1l-2.7-2.1c-.8.5-1.7.8-2.9.8-2.2 0-4.1-1.5-4.8-3.5H1.4v2.2C2.8 16 5.7 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M4.2 11.1c-.2-.5-.3-1.1-.3-1.6s.1-1.1.3-1.6V5.6H1.4C.5 7 0 8.5 0 9.5s.5 2.5 1.4 3.9l2.8-2.3z"
        fill="#FBBC04"
      />
      <path
        d="M9 3.6c1.3 0 2.4.4 3.3 1.3l2.4-2.4C13.2.9 11.3 0 9 0 5.7 0 2.8 2 1.4 4.6l2.8 2.2C5 5.1 6.8 3.6 9 3.6z"
        fill="#EA4335"
      />
    </svg>
  )
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
  const [googleSubmitting, setGoogleSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(
    initialError ? errorMessages[initialError] ?? errorMessages.unknown : null
  )

  const handleGoogle = async () => {
    setGoogleSubmitting(true)
    setError(null)
    const r = await signInWithGoogle(next)
    if (r.ok) {
      window.location.href = r.url
    } else {
      setGoogleSubmitting(false)
      setError(r.error)
    }
  }

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
    <>
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
        type="button"
        onClick={handleGoogle}
        disabled={googleSubmitting}
        className="btn btn--full"
        style={{
          background: "#fff",
          color: "var(--ink)",
          border: "1px solid var(--line-strong)",
          gap: 10,
          textTransform: "none",
          letterSpacing: "0.02em",
          fontWeight: 500,
        }}
      >
        <GoogleIcon />
        {googleSubmitting ? "Conectando…" : "Continuar con Google"}
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "20px 0 16px",
          color: "var(--ink-mute)",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        o con email
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </div>

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

        <button
          className="btn btn--primary btn--full"
          type="submit"
          disabled={submitting || !email}
        >
          {submitting ? "Enviando…" : "Enviarme un link"}
        </button>
      </form>
    </>
  )
}
