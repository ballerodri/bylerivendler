"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deletePackPurchase } from "../../actions"

export default function PackDeleteButton({
  purchaseId,
  linkedAppointmentsCount,
}: {
  purchaseId: string
  linkedAppointmentsCount: number
}) {
  const [state, setState] = useState<"idle" | "confirming">("idle")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const r = await deletePackPurchase(purchaseId)
      if (r.ok) {
        setState("idle")
        router.refresh()
      } else {
        setError(r.error ?? "Error al eliminar.")
      }
    })
  }

  if (state === "confirming") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        <span style={{ fontSize: 12, color: "#8c463c", textAlign: "right" }}>
          ¿Eliminar este pack?{" "}
          {linkedAppointmentsCount > 0
            ? `Se van a desvincular ${linkedAppointmentsCount} turno${linkedAppointmentsCount === 1 ? "" : "s"} (quedan como turnos sueltos, no se borran).`
            : "No tiene turnos vinculados."}{" "}
          No se puede deshacer.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleDelete} disabled={pending} className="adm-btn adm-btn--danger">
            {pending ? "Eliminando…" : "Sí, eliminar pack"}
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
      Eliminar pack
    </button>
  )
}
