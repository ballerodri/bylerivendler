import type { Metadata } from "next"
import { Cormorant_Garamond, Inter_Tight, Italiana, JetBrains_Mono } from "next/font/google"
import { QueryProvider } from "@/lib/query-client"
import "./globals.css"

const serif = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
})

const sans = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})

const script = Italiana({
  variable: "--font-script",
  subsets: ["latin"],
  weight: ["400"],
})

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
})

export const metadata: Metadata = {
  metadataBase: new URL("https://bylerivendler.com"),
  title: {
    default: "By Leri Vendler · Estética profesional",
    template: "%s · By Leri Vendler",
  },
  description:
    "Estética profesional en Pilar, Buenos Aires. Tratamientos faciales, corporales y masajes. Reservá tu turno online en pocos minutos.",
  applicationName: "By Leri Vendler",
  authors: [{ name: "By Leri Vendler" }],
  keywords: [
    "estética",
    "tratamientos faciales",
    "tratamientos corporales",
    "masajes",
    "Pilar",
    "Pilar",
    "By Leri Vendler",
  ],
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: "https://bylerivendler.com",
    title: "By Leri Vendler · Estética profesional",
    description:
      "Tratamientos faciales, corporales y masajes en Pilar, Buenos Aires. Reservá tu turno online.",
    siteName: "By Leri Vendler",
  },
  twitter: {
    card: "summary_large_image",
    title: "By Leri Vendler · Estética profesional",
    description:
      "Tratamientos faciales, corporales y masajes en Pilar, Buenos Aires. Reservá tu turno online.",
  },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BeautySalon",
  name: "By Leri Vendler",
  url: "https://bylerivendler.com",
  description:
    "Estética profesional en Pilar, Buenos Aires. Tratamientos faciales, corporales y masajes.",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Sanguinetti 297",
    addressLocality: "Pilar",
    postalCode: "B1629",
    addressRegion: "Buenos Aires",
    addressCountry: "AR",
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: -34.4587,
    longitude: -58.9142,
  },
  areaServed: "Pilar, Buenos Aires",
  priceRange: "$$",
  image: "https://bylerivendler.com/og-image.jpg",
  sameAs: [],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es-AR"
      className={`${serif.variable} ${sans.variable} ${script.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
