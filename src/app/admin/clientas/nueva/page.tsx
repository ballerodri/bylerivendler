import Link from "next/link"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import NuevaClientaForm from "./nueva-clienta-form"

export const dynamic = "force-dynamic"

export default async function NuevaClientaPage() {
  // Cargar/editar clientas es de admin/recepción, igual que la ficha.
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  return (
    <>
      <p className="adm-eyebrow">
        <Link href="/admin/clientas" style={{ color: "var(--ink-mute)" }}>← Clientas</Link>
      </p>
      <h1 className="adm-h1">Nueva <em>clienta</em></h1>
      <p className="adm-lede">
        Cargá los datos de una clienta sin tener que hacer una reserva. Después podés
        agregarle el DNI, fotos y el consentimiento desde su ficha.
      </p>
      <NuevaClientaForm />
    </>
  )
}
