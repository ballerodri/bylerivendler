"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"

export default function LogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const logout = async () => {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  return (
    <button className="linkbtn" onClick={logout} disabled={loading}>
      {loading ? "Saliendo…" : "Cerrar sesión"}
    </button>
  )
}
