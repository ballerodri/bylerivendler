"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toggleComboActive } from "../actions"

export default function ComboActiveToggle({ comboId, active }: { comboId: string; active: boolean }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const handle = () => {
    startTransition(async () => {
      await toggleComboActive(comboId, !active)
      router.refresh()
    })
  }

  return (
    <button
      onClick={handle}
      disabled={pending}
      className="adm-btn"
      style={{ fontSize: 12, padding: "4px 10px" }}
    >
      {pending ? "…" : active ? "Desactivar" : "Activar"}
    </button>
  )
}
