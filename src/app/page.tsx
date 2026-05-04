import Link from "next/link"

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#f2ede6] px-6 py-16 text-[#2b2623]">
      <main className="flex max-w-2xl flex-col items-center gap-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-crop.png" alt="By Leri Vendler" className="h-24 w-auto" />
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#7a6e64]">
          Estética profesional · Buenos Aires
        </p>
        <h1
          className="text-5xl leading-tight tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Un{" "}
          <em style={{ color: "#b68a5f" }}>ritual</em>{" "}
          a tu medida.
        </h1>
        <p className="max-w-md text-base leading-relaxed text-[#4a423d]">
          Tratamientos faciales, corporales y masajes en Palermo. Reservá tu
          turno online en pocos minutos.
        </p>
        <Link
          href="/reserva"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#2b2623] px-8 text-xs uppercase tracking-[0.12em] text-[#f2ede6] transition hover:-translate-y-px hover:shadow-lg"
        >
          Reservar turno
        </Link>
      </main>
    </div>
  )
}
