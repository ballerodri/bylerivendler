import Link from "next/link"
import "./legal.css"

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="legal">
      <div className="legal__inner">
        <Link href="/" className="legal__brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-crop.png" alt="By Leri Vendler" />
        </Link>
        {children}
        <div className="legal__footer">
          <span>© By Leri Vendler · Buenos Aires, Argentina</span>
          <span>
            <Link href="/privacidad">Privacidad</Link>
            {" · "}
            <Link href="/terminos">Términos</Link>
          </span>
        </div>
      </div>
    </div>
  )
}
