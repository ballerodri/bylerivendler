// src/lib/arca/wsaa-sign.test.ts
import { describe, it, expect } from "vitest"
import forge from "node-forge"
import { buildTra, signTra } from "./wsaa-sign"

describe("buildTra", () => {
  it("incluye el servicio y un uniqueId basado en el tiempo", () => {
    const now = new Date("2026-06-19T12:00:00Z")
    const tra = buildTra("wsfe", now)
    expect(tra).toContain("<service>wsfe</service>")
    expect(tra).toContain(`<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`)
    expect(tra).toContain("<generationTime>")
    expect(tra).toContain("<expirationTime>")
  })
})

describe("signTra", () => {
  it("devuelve un CMS en base64 decodificable", () => {
    // Cert + clave de juguete para el test
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = "01"
    cert.validity.notBefore = new Date("2026-01-01")
    cert.validity.notAfter = new Date("2027-01-01")
    const attrs = [{ name: "commonName", value: "test" }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const certPem = forge.pki.certificateToPem(cert)
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey)

    const cms = signTra("<x/>", certPem, keyPem)
    expect(cms.length).toBeGreaterThan(0)
    // Debe ser base64 válido que decodifica a un PKCS7
    const der = forge.util.decode64(cms)
    const asn1 = forge.asn1.fromDer(der)
    expect(asn1).toBeTruthy()
    // El ContentType OID del top-level debe ser signedData (1.2.840.113549.1.7.2)
    const topChildren = asn1.value as forge.asn1.Asn1[]
    const oidBytes = topChildren[0].value as string
    const contentTypeOid = forge.asn1.derToOid(oidBytes)
    expect(contentTypeOid).toBe("1.2.840.113549.1.7.2")
  })
})
