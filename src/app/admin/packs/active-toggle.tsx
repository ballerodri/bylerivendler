"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { togglePackActive } from "./actions"

export default function PackActiveToggle({ packId, active }: { packId: string; active: boolean }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <button
      onClick={() => startTransition(async () => { await togglePackActive(packId, !active); router.refresh() })}
      disabled={pending}
      className="adm-btn"
      style={{ fontSize: 12, padding: "4px 10px" }}
    >
      {pending ? "…" : active ? "Desactivar" : "Activar"}
    </button>
  )
}
