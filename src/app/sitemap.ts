import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://bylerivendler.com"

  return [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/reserva`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/privacidad`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terminos`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ]
}
