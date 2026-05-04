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
  title: "By Leri Vendler",
  description: "Estética profesional · Reservá tu turno",
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
      <body className="min-h-full flex flex-col">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
