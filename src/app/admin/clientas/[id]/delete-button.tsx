"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteClient } from "../../actions"

export default function ClientDeleteButton({ clientId, name }: { clientId: string; name: string }) {
  const [state, setState] = useState<"idle" | "confirming">("idle")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const r = await deleteClient(clientId)
      if (r.ok) {
        router.push("/admin/clientas")
      } else {
        setError(r.error ?? "Error al eliminar.")
        setState("idle")
      }
    })
  }

  if (state === "confirming") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, color: "#8c463c" }}>
          ¿Eliminar a <strong>{name}</strong>? Se borran también sus turnos, fichas, fotos y packs. No se puede deshacer.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleDelete}
            disabled={pending}
            className="adm-btn adm-btn--danger"
          >
            {pending ? "Eliminando…" : "Sí, eliminar clienta"}
          </button>
          <button onClick={() => { setState("idle"); setError(null) }} disabled={pending} className="adm-btn">
            Cancelar
          </button>
        </div>
        {error && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
      </div>
    )
  }

  return (
    <button
      onClick={() => setState("confirming")}
      className="adm-btn adm-btn--danger"
      style={{ fontSize: 12 }}
    >
      Eliminar clienta
    </button>
  )
}
