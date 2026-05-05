import LoginForm from "./form"
import "../reserva/reserva.css"

export const metadata = {
  title: "Ingresar · By Leri Vendler",
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  return <LoginPageInner searchParamsPromise={searchParams} />
}

async function LoginPageInner({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ next?: string; error?: string }>
}) {
  const sp = await searchParamsPromise
  return (
    <div
      className="blv"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/logo-crop.png"
            alt="By Leri Vendler"
            style={{ height: 96, width: "auto", display: "inline-block" }}
          />
        </div>
        <p className="eyebrow" style={{ textAlign: "center" }}>
          Ingresar a tu portal
        </p>
        <h1 className="headline" style={{ textAlign: "center", fontSize: 32 }}>
          Te <em>esperamos</em>.
        </h1>
        <p className="lede" style={{ textAlign: "center", margin: "0 auto 24px" }}>
          Continuá con tu cuenta de Google o pedí un link al email. Sin
          contraseñas.
        </p>

        <LoginForm next={sp.next} initialError={sp.error} />

        <p
          style={{
            fontSize: 11,
            color: "var(--ink-mute)",
            textAlign: "center",
            marginTop: 24,
            lineHeight: 1.5,
          }}
        >
          ¿Primera vez?{" "}
          <a
            href="/reserva"
            style={{ color: "var(--gold)", textDecoration: "underline" }}
          >
            Reservá un turno
          </a>{" "}
          y te creamos tu acceso automáticamente.
        </p>
      </div>
    </div>
  )
}
