import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ManualForm from "./manual-form"

export const dynamic = "force-dynamic"

export default async function NuevaFacturaPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  return (
    <>
      <p className="adm-eyebrow">Facturación</p>
      <h1 className="adm-h1">Factura <em>manual</em></h1>
      <p className="adm-lede">Para señas, ventas sueltas o un servicio puntual. Emite una Factura C.</p>
      <ManualForm />
    </>
  )
}
