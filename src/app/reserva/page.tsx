import { fetchCatalog, fetchCurrentClient, fetchProfessionals, fetchBusinessHours, type AuthProfile } from "./queries"
import ReservaFlow from "./flow"
import { createClient } from "@/lib/supabase/server"
import "./reserva.css"

export const dynamic = "force-dynamic"

export default async function ReservaPage() {
  const [categories, professionals, businessHours, supabase] = await Promise.all([
    fetchCatalog(),
    fetchProfessionals(),
    fetchBusinessHours(),
    createClient(),
  ])

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const currentClient = user ? await fetchCurrentClient(user.id) : null

  // Si está autenticada pero todavía no tiene un row en `clients` (caso típico
  // de signup con Google sin reservar antes), pre-cargamos lo que sabemos del
  // perfil de Google para el formulario.
  let authProfile: AuthProfile | null = null
  if (user && !currentClient) {
    const meta = user.user_metadata as { full_name?: string; name?: string }
    authProfile = {
      email: user.email ?? "",
      fullName: meta?.full_name ?? meta?.name ?? null,
    }
  }

  return (
    <ReservaFlow
      categories={categories}
      professionals={professionals}
      businessHours={businessHours}
      currentClient={currentClient}
      authProfile={authProfile}
    />
  )
}
