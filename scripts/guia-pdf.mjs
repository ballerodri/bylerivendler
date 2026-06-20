// Convierte docs/guia-admin.md en docs/guia-admin.html con estilo de marca.
// Para regenerar el PDF:
//   1) node scripts/guia-pdf.mjs
//   2) chrome --headless --disable-gpu --no-pdf-header-footer \
//        --print-to-pdf=docs/guia-admin.pdf file:///<ruta>/docs/guia-admin.html
import { marked } from "marked"
import { readFileSync, writeFileSync } from "node:fs"

const md = readFileSync("docs/guia-admin.md", "utf8")
const body = marked.parse(md)

const html = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>Guía del panel — By Leri Vendler</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #2b2623; line-height: 1.55; font-size: 11.5pt; margin: 0; }
  h1 { font-size: 24pt; font-weight: 400; border-bottom: 2px solid #2b2623; padding-bottom: 8px; margin: 0 0 18px; letter-spacing: -0.01em; }
  h2 { font-size: 16pt; font-weight: 500; margin: 26px 0 10px; border-bottom: 1px solid #e2dacd; padding-bottom: 4px; page-break-after: avoid; }
  h3 { font-size: 12.5pt; font-weight: 600; color: #5a4a3a; margin: 16px 0 6px; page-break-after: avoid; }
  p { margin: 0 0 9px; }
  ul, ol { margin: 0 0 9px; padding-left: 22px; }
  li { margin: 3px 0; }
  strong { color: #2b2623; }
  code { font-family: Consolas, "Courier New", monospace; background: #efe8df; padding: 1px 5px; border-radius: 4px; font-size: 0.88em; }
  a { color: #7a6e64; text-decoration: none; }
  hr { border: none; border-top: 1px solid #e2dacd; margin: 22px 0; }
  blockquote { background: #f6f1ea; border-left: 3px solid #b68a5f; margin: 12px 0; padding: 8px 16px; border-radius: 0 8px 8px 0; page-break-inside: avoid; }
  blockquote p { margin: 6px 0; font-size: 10.8pt; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.8pt; page-break-inside: avoid; }
  th, td { border: 1px solid #ddd3c6; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #efe8df; font-weight: 600; }
</style>
</head>
<body>${body}</body>
</html>`

writeFileSync("docs/guia-admin.html", html)
console.log("✓ docs/guia-admin.html generado")
