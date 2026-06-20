import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "@/app/reserva/data"
import { ddmmyyyy, receptorDocLabel } from "@/lib/arca/format"
import ReenviarButton from "./reenviar-button"

export const dynamic = "force-dynamic"

type InvoiceRow = {
  id: string
  cbte_nro: number
  pto_vta: number
  fecha_emision: string
  receptor_doc_tipo: number
  receptor_doc_nro: string
  receptor_nombre: string | null
  total_cents: number
  estado: string
  environment: string
}

export default async function FacturacionPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("invoices")
    .select("id, cbte_nro, pto_vta, fecha_emision, receptor_doc_tipo, receptor_doc_nro, receptor_nombre, total_cents, estado, environment")
    .order("created_at", { ascending: false })
    .limit(200)

  const invoices = (data ?? []) as InvoiceRow[]

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="adm-eyebrow" style={{ marginBottom: 0 }}>Facturación</p>
        <Link href="/admin/facturacion/nueva" className="adm-btn" style={{ fontSize: 12 }}>
          + Factura manual
        </Link>
      </div>
      <h1 className="adm-h1">Fac<em>turas</em></h1>
      <p className="adm-lede">{invoices.length} comprobante{invoices.length === 1 ? "" : "s"}.</p>

      <div className="adm-card">
        {invoices.length === 0 ? (
          <div className="adm-empty">Todavía no emitiste facturas.</div>
        ) : (
          invoices.map((f) => {
            const nro = `${String(f.pto_vta).padStart(4, "0")}-${String(f.cbte_nro).padStart(8, "0")}`
            return (
              <div key={f.id} className="adm-list-row" style={{ gridTemplateColumns: "auto 1fr auto auto auto" }}>
                <div className="adm-time" style={{ fontSize: 13 }}>{ddmmyyyy(f.fecha_emision)}</div>
                <div>
                  <div className="adm-name">
                    Factura C {nro}
                    {f.environment === "homologacion" && (
                      <span className="adm-pill" style={{ marginLeft: 8, background: "#eae2d7", color: "#8c6a3c", fontSize: 10 }}>PRUEBA</span>
                    )}
                  </div>
                  <div className="adm-sub">
                    {f.receptor_nombre ?? receptorDocLabel(f.receptor_doc_tipo, f.receptor_doc_nro)}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(f.total_cents / 100)}</div>
                <div>
                  <a className="adm-btn adm-btn--ghost" href={`/api/admin/facturacion/${f.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a>
                </div>
                <div className="adm-actions">
                  <ReenviarButton invoiceId={f.id} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
