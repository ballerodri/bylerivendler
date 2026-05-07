"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteStaff } from "../actions"

export default function StaffDeleteButton({ staffId, name }: { staffId: string; name: string }) {
  const [state, setState] = useState<"idle" | "confirming">("idle")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const r = await deleteStaff(staffId)
      if (r.ok) {
        router.refresh()
      } else {
        setError(r.error ?? "Error al eliminar.")
        setState("idle")
      }
    })
  }

  if (state === "confirming") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
            ¿Eliminar a {name}?
          </span>
          <button
            onClick={handleDelete}
            disabled={pending}
            className="adm-btn"
            style={{ fontSize: 11, padding: "3px 8px", color: "#8c463c", borderColor: "#8c463c" }}
          >
            {pending ? "…" : "Sí, eliminar"}
          </button>
          <button
            onClick={() => { setState("idle"); setError(null) }}
            disabled={pending}
            className="adm-btn"
            style={{ fontSize: 11, padding: "3px 8px" }}
          >
            Cancelar
          </button>
        </div>
        {error && (
          <span style={{ fontSize: 11, color: "#8c463c", maxWidth: 280, textAlign: "right" }}>
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => setState("confirming")}
      className="adm-btn"
      style={{ fontSize: 12, padding: "4px 10px", color: "#8c463c", borderColor: "#8c463c" }}
    >
      Eliminar
    </button>
  )
}
