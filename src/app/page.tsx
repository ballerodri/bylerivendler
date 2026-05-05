import Link from "next/link"

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-[#f2ede6] text-[#2b2623]">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="flex max-w-2xl flex-col items-center gap-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-crop.png" alt="By Leri Vendler" className="h-24 w-auto" />
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
        </div>
      </main>

      <footer className="border-t border-[rgba(43,38,35,0.1)] px-6 py-6 text-center text-[12px] text-[#7a6e64]">
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-between gap-2 sm:flex-row sm:gap-4">
          <span>© By Leri Vendler · Buenos Aires, Argentina</span>
          <span className="flex items-center gap-3">
            <Link href="/login" className="hover:text-[#2b2623]">
              Ingresar
            </Link>
            <span aria-hidden>·</span>
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
