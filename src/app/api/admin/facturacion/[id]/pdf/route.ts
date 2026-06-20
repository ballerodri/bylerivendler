import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { loadInvoicePdfData } from "@/lib/arca/invoice-pdf"
import { renderInvoicePdf } from "@/lib/arca/pdf"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
  }

  const { id } = await params
  const data = await loadInvoicePdfData(id)
  if (!data) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })

  const pdfBuffer = await renderInvoicePdf(data)
  const nro = `${String(data.ptoVta).padStart(4, "0")}-${String(data.nro).padStart(8, "0")}`
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="factura-${nro}.pdf"`,
    },
  })
}
