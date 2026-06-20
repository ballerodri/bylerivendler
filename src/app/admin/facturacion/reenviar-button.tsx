"use client"

import { useState, useTransition } from "react"
import { reenviarFacturaEmail } from "./actions"

export default function ReenviarButton({ invoiceId }: { invoiceId: string }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <>
      <button
        className="adm-btn adm-btn--ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reenviarFacturaEmail(invoiceId)
            setMsg(r.ok ? "Enviado ✓" : r.error ?? "Error")
          })
        }
      >
        {pending ? "Enviando…" : "Reenviar email"}
      </button>
      {msg && <span style={{ fontSize: 11, color: "var(--ink-mute)", marginLeft: 6 }}>{msg}</span>}
    </>
  )
}
