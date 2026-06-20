import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { emitirFactura } from "@/lib/arca/invoice-service"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) {
    return NextResponse.json({ ok: false, error: "Acceso denegado" }, { status: 403 })
  }

  try {
    const result = await emitirFactura({
      concepto: 2,
      docTipo: 99, // Consumidor Final
      docNro: "0",
      condIvaReceptor: 5,
      totalCents: 100, // $1 de prueba
      descripcion: "Prueba ARCA",
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
