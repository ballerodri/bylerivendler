import { fetchCatalog, fetchCombos, fetchCurrentClient, fetchProfessionals, fetchBusinessHours, countActivePacks, type AuthProfile } from "./queries"
import ReservaFlow from "./flow"
import { createClient } from "@/lib/supabase/server"
import "./reserva.css"

export const dynamic = "force-dynamic"

export default async function ReservaPage() {
  const [categories, combos, professionals, businessHours, packsCount, supabase] = await Promise.all([
    fetchCatalog(),
    fetchCombos(),
    fetchProfessionals(),
    fetchBusinessHours(),
    countActivePacks(),
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
    <>
      {packsCount > 0 && (
        <a
          href="/packs"
          style={{
            display: "block",
            textAlign: "center",
            background: "#2b2623",
            color: "#f2ede6",
            padding: "10px 16px",
            fontSize: 13,
            textDecoration: "none",
            fontFamily: "Helvetica, Arial, sans-serif",
            letterSpacing: "0.03em",
          }}
        >
          ✨ Mirá nuestros <strong>packs de sesiones</strong> con precio especial →
        </a>
      )}
      <ReservaFlow
        categories={categories}
        combos={combos}
        professionals={professionals}
        businessHours={businessHours}
        currentClient={currentClient}
        authProfile={authProfile}
      />
    </>
  )
}
