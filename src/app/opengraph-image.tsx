import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "By Leri Vendler · Estética profesional en Pilar"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f0ece8",
          gap: 24,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://bylerivendler.com/assets/logo-oauth.png"
          width={220}
          height={220}
          alt=""
          style={{ objectFit: "contain" }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 64, fontWeight: 700, color: "#3a3530", letterSpacing: "-1px" }}>
            By Leri Vendler
          </span>
          <span style={{ fontSize: 22, color: "#7a6e64", letterSpacing: "6px", textTransform: "uppercase" }}>
            Estética profesional · Pilar, Buenos Aires
          </span>
        </div>
      </div>
    ),
    { ...size }
  )
}
