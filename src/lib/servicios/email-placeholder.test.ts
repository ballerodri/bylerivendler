import { describe, it, expect } from "vitest"
import { esEmailPlaceholder, emailParaMostrar } from "./email-placeholder"

describe("esEmailPlaceholder", () => {
  it("el placeholder del salón es 'sin email'", () => {
    expect(esEmailPlaceholder("admin_created_1785866640432@noemail.local")).toBe(true)
  })
  it("vacío / null / undefined es 'sin email'", () => {
    expect(esEmailPlaceholder("")).toBe(true)
    expect(esEmailPlaceholder(null)).toBe(true)
    expect(esEmailPlaceholder(undefined)).toBe(true)
    expect(esEmailPlaceholder("   ")).toBe(true)
  })
  it("no distingue mayúsculas", () => {
    expect(esEmailPlaceholder("Admin_Created_9@NoEmail.Local")).toBe(true)
  })
  it("un email real NO es placeholder", () => {
    expect(esEmailPlaceholder("ana@gmail.com")).toBe(false)
  })
})

describe("emailParaMostrar", () => {
  it("un placeholder se muestra vacío", () => {
    expect(emailParaMostrar("admin_created_1@noemail.local")).toBe("")
  })
  it("un email real se muestra tal cual (recortado)", () => {
    expect(emailParaMostrar("  ana@gmail.com ")).toBe("ana@gmail.com")
  })
  it("null se muestra vacío", () => {
    expect(emailParaMostrar(null)).toBe("")
  })
})
