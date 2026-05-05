"use client"

import { useState, useTransition } from "react"
import { setStaffActive } from "../actions"

export default function StaffActiveToggle({
  staffId,
  active,
}: {
  staffId: string
  active: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      const r = await setStaffActive(staffId, !active)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  return (
    <>
      <button
        className={`adm-btn ${active ? "adm-btn--danger" : "adm-btn--primary"}`}
        onClick={toggle}
        disabled={pending}
      >
        {pending ? "…" : active ? "Desactivar" : "Reactivar"}
      </button>
      {error && (
        <span style={{ fontSize: 10, color: "#8c463c", marginLeft: 6 }}>{error}</span>
      )}
    </>
  )
}
