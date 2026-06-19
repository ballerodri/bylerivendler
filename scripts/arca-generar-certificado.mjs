// scripts/arca-generar-certificado.mjs
// Uso: node scripts/arca-generar-certificado.mjs <CUIT> [alias]
import forge from "node-forge"
import { writeFileSync } from "node:fs"

const cuit = process.argv[2]
const alias = process.argv[3] ?? "byleri"

if (!cuit || !/^\d{11}$/.test(cuit)) {
  console.error("Uso: node scripts/arca-generar-certificado.mjs <CUIT de 11 dígitos> [alias]")
  process.exit(1)
}

console.log("Generando clave privada (2048 bits)… puede tardar unos segundos.")
const keys = forge.pki.rsa.generateKeyPair(2048)

const csr = forge.pki.createCertificationRequest()
csr.publicKey = keys.publicKey
csr.setSubject([
  { name: "countryName", value: "AR" },
  { name: "organizationName", value: "By Leri Vendler" },
  { name: "commonName", value: alias },
  { name: "serialNumber", value: `CUIT ${cuit}` },
])
csr.sign(keys.privateKey, forge.md.sha256.create())

const keyFile = `arca-${alias}.key`
const csrFile = `arca-${alias}.csr`
writeFileSync(keyFile, forge.pki.privateKeyToPem(keys.privateKey))
writeFileSync(csrFile, forge.pki.certificationRequestToPem(csr))

console.log(`\n✓ Clave privada: ${keyFile}  (GUARDALA, no la subas a ARCA ni a git)`)
console.log(`✓ Pedido de certificado: ${csrFile}  (este es el que subís a ARCA)`)
console.log(`\nPróximo paso: abrí ${csrFile}, copiá todo su contenido y pegalo en ARCA (WSASS → Nuevo certificado).`)
