"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deletePack } from "./actions"

export default function PackDeleteButton({ packId, name }: { packId: string; name: string }) {
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)
  const router = useRouter()

  if (confirm) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#8c463c" }}>¿Eliminar &quot;{name}&quot;?</span>
        <button
          className="adm-btn adm-btn--danger"
          disabled={pending}
          onClick={() => startTransition(async () => { await deletePack(packId); router.refresh() })}
        >
          Sí
        </button>
        <button className="adm-btn" onClick={() => setConfirm(false)}>No</button>
      </span>
    )
  }
  return (
    <button className="adm-btn" style={{ color: "var(--ink-mute)", fontSize: 12 }} onClick={() => setConfirm(true)}>
      Eliminar
    </button>
  )
}
