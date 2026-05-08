import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/reserva", "/privacidad", "/terminos"],
        disallow: ["/admin/", "/portal/", "/login", "/reserva/exito"],
      },
    ],
    sitemap: "https://bylerivendler.com/sitemap.xml",
  }
}
