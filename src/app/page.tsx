import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { isStaffUser } from "@/lib/staff"

export const dynamic = "force-dynamic"

type ClientRow = {
  id: string
  first_name: string | null
}

type ApptRow = {
  id: string
  starts_at: string
  status: string
  appointment_services: { service: { name: string } | null }[]
}

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let firstName: string | null = null
  let nextAppt: ApptRow | null = null
  let staff = false

  if (user) {
    staff = await isStaffUser(user.id)
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    if (!staff) {
      const { data: client } = await admin
        .from("clients")
        .select("id, first_name")
        .eq("user_id", user.id)
        .maybeSingle<ClientRow>()
      firstName = client?.first_name ?? null

      if (client) {
        const { data } = await admin
          .from("appointments")
          .select(
            "id, starts_at, status, appointment_services(service:services(name))"
          )
          .eq("client_id", client.id)
          .gte("starts_at", new Date().toISOString())
          .in("status", ["pending", "confirmed"])
          .order("starts_at", { ascending: true })
          .limit(1)
          .maybeSingle()
        nextAppt = data as unknown as ApptRow | null
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-[#f2ede6] text-[#2b2623]">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/logo-crop.png"
            alt="By Leri Vendler"
            className="h-12 w-auto"
          />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            staff ? (
              <Link
                href="/admin"
                className="rounded-full border border-[rgba(43,38,35,0.2)] bg-white px-5 py-2 text-xs font-medium uppercase tracking-[0.12em] transition hover:bg-[#eae2d7]"
              >
                Panel admin
              </Link>
            ) : (
              <Link
                href="/portal"
                className="rounded-full border border-[rgba(43,38,35,0.2)] bg-white px-5 py-2 text-xs font-medium uppercase tracking-[0.12em] transition hover:bg-[#eae2d7]"
              >
                Mi portal
              </Link>
            )
          ) : (
            <Link
              href="/login"
              className="text-[#7a6e64] hover:text-[#2b2623]"
            >
              Ingresar
            </Link>
          )}
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        {user && firstName && !staff ? (
          <LoggedInView firstName={firstName} nextAppt={nextAppt} />
        ) : (
          <MarketingView />
        )}
      </main>

      <footer className="border-t border-[rgba(43,38,35,0.1)] px-6 py-6 text-center text-[12px] text-[#7a6e64]">
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-between gap-2 sm:flex-row sm:gap-4">
          <span>© By Leri Vendler · Buenos Aires, Argentina</span>
          <span className="flex items-center gap-3">
            <Link href="/privacidad" className="hover:text-[#2b2623]">
              Privacidad
            </Link>
            <span aria-hidden>·</span>
            <Link href="/terminos" className="hover:text-[#2b2623]">
              Términos
            </Link>
          </span>
        </div>
      </footer>
    </div>
  )
}

function MarketingView() {
  return (
    <div className="flex max-w-2xl flex-col items-center gap-8 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/logo-crop.png"
        alt="By Leri Vendler"
        className="h-24 w-auto"
      />
      <p className="text-[10px] uppercase tracking-[0.22em] text-[#7a6e64]">
        Estética profesional · Pilar · Bs. As.
      </p>
      <h1
        className="text-5xl leading-tight tracking-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Un <em style={{ color: "#b68a5f" }}>ritual</em> a tu medida.
      </h1>
      <p className="max-w-md text-base leading-relaxed text-[#4a423d]">
        Tratamientos faciales, corporales y masajes.
        <br />
        Reservá tu turno online en pocos minutos.
      </p>
      <Link
        href="/reserva"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#2b2623] px-8 text-xs uppercase tracking-[0.12em] text-[#f2ede6] transition hover:-translate-y-px hover:shadow-lg"
      >
        Reservar turno
      </Link>
      <p className="mt-4 text-xs text-[#7a6e64]">
        ¿Ya sos clienta?{" "}
        <Link href="/login" className="text-[#b68a5f] underline">
          Ingresá a tu portal
        </Link>
      </p>
    </div>
  )
}

function LoggedInView({
  firstName,
  nextAppt,
}: {
  firstName: string
  nextAppt: ApptRow | null
}) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-6 text-center">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[#7a6e64]">
        Bienvenida de vuelta
      </p>
      <h1
        className="text-5xl leading-tight tracking-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Hola, <em style={{ color: "#b68a5f" }}>{firstName}</em>.
      </h1>

      {nextAppt ? (
        <div className="rounded-2xl border border-[rgba(43,38,35,0.1)] bg-white p-6 text-left">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#7a6e64]">
            Tu próximo turno
          </p>
          <p
            className="mt-2 text-2xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {new Date(nextAppt.starts_at).toLocaleString("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="mt-2 text-sm text-[#4a423d]">
            {nextAppt.appointment_services
              .map((as) => as.service?.name)
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ) : (
        <p className="text-base text-[#4a423d]">
          No tenés turnos próximos.
        </p>
      )}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link
          href="/reserva"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#2b2623] px-8 text-xs uppercase tracking-[0.12em] text-[#f2ede6] transition hover:-translate-y-px hover:shadow-lg"
        >
          Reservar otro turno
        </Link>
        <Link
          href="/portal"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[rgba(43,38,35,0.2)] bg-white px-8 text-xs uppercase tracking-[0.12em] transition hover:bg-[#eae2d7]"
        >
          Ver mi historial
        </Link>
      </div>
    </div>
  )
}
