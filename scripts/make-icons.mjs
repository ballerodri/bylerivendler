// Genera los iconos del sitio (favicon, apple touch icon, OpenGraph) a partir
// de logo-oauth.png. Output:
//   src/app/icon.png            (256x256, browser tab favicon)
//   src/app/apple-icon.png      (180x180, iOS home screen)
//   src/app/opengraph-image.png (1200x630, link previews en redes)
//
// Next.js 16 detecta automáticamente estos archivos y genera los <meta> tags.

import sharp from "sharp"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const src = join(root, "public/assets/logo-oauth.png")

const PAPER = { r: 0xf2, g: 0xed, b: 0xe6, alpha: 1 }

// 1) Favicon — paper bg, logo centered, padding modesto
await sharp({
  create: { width: 256, height: 256, channels: 4, background: PAPER },
})
  .composite([
    {
      input: await sharp(src)
        .resize({ width: 220, height: 220, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer(),
      gravity: "center",
    },
  ])
  .png()
  .toFile(join(root, "src/app/icon.png"))
console.log("✓ src/app/icon.png")

// 2) Apple touch icon — paper bg, padding más generoso
await sharp({
  create: { width: 180, height: 180, channels: 4, background: PAPER },
})
  .composite([
    {
      input: await sharp(src)
        .resize({ width: 140, height: 140, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer(),
      gravity: "center",
    },
  ])
  .png()
  .toFile(join(root, "src/app/apple-icon.png"))
console.log("✓ src/app/apple-icon.png")

// 3) OpenGraph image — 1200x630, paper bg, logo a la izquierda + texto a la derecha
const W = 1200
const H = 630
const logoSize = 360

const ogText = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <text x="${W / 2}" y="${H / 2 + 130}" text-anchor="middle"
        font-family="Georgia, serif" font-size="56" font-weight="500" fill="#2B2623">
    By Leri Vendler
  </text>
  <text x="${W / 2}" y="${H / 2 + 180}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="20"
        letter-spacing="6" fill="#7A6E64">
    ESTÉTICA PROFESIONAL · BUENOS AIRES
  </text>
</svg>
`

await sharp({
  create: { width: W, height: H, channels: 4, background: PAPER },
})
  .composite([
    {
      input: await sharp(src)
        .resize({ width: logoSize, height: logoSize, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer(),
      top: 90,
      left: (W - logoSize) / 2,
    },
    { input: Buffer.from(ogText), top: 0, left: 0 },
  ])
  .png()
  .toFile(join(root, "src/app/opengraph-image.png"))
console.log("✓ src/app/opengraph-image.png")
