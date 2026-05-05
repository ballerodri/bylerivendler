// Genera una versión del logo con fondo paper (#F2EDE6) y forma circular,
// optimizada para la pantalla de consentimiento de OAuth de Google
// (que se muestra en dark mode con frecuencia).
//
// Output: public/assets/logo-oauth.png — 1024x1024

import sharp from "sharp"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const src = join(root, "public/assets/logo-crop.png")
const dst = join(root, "public/assets/logo-oauth.png")

if (!existsSync(src)) {
  console.error("No se encontró logo-crop.png en public/assets/")
  process.exit(1)
}

const SIZE = 1024
const BG = { r: 0xf2, g: 0xed, b: 0xe6, alpha: 1 }
const LOGO_PADDING = 110 // padding around the logo within the canvas

const innerSize = SIZE - LOGO_PADDING * 2

const resized = await sharp(src)
  .resize({
    width: innerSize,
    height: innerSize,
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .toBuffer()

await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: BG,
  },
})
  .composite([{ input: resized, gravity: "center" }])
  .png()
  .toFile(dst)

console.log(`Generado: ${dst}`)
