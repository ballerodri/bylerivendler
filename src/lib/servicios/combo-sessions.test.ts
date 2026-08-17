import { describe, it, expect } from "vitest"
import {
  programSessionStates,
  programAllScheduled,
  programRemainingTotal,
  programSchedulableServices,
  type ProgramService,
} from "./combo-sessions"

const services: ProgramService[] = [
  { serviceId: "ultra", serviceName: "Ultracavitación", sessionsTotal: 4 },
  { serviceId: "vela", serviceName: "Vela Slim", sessionsTotal: 4 },
  { serviceId: "up", serviceName: "Vela Up", sessionsTotal: 6 },
]

describe("programSessionStates", () => {
  it("sin nada agendado: usadas 0, restantes = total", () => {
    const st = programSessionStates(services, {})
    expect(st.map((s) => s.sessionsRemaining)).toEqual([4, 4, 6])
    expect(st.map((s) => s.sessionsUsed)).toEqual([0, 0, 0])
  })
  it("descuenta las usadas por servicio", () => {
    const st = programSessionStates(services, { ultra: 2, up: 6 })
    expect(st.find((s) => s.serviceId === "ultra")!.sessionsRemaining).toBe(2)
    expect(st.find((s) => s.serviceId === "vela")!.sessionsRemaining).toBe(4)
    expect(st.find((s) => s.serviceId === "up")!.sessionsRemaining).toBe(0)
  })
  it("topea las usadas al total (nunca restantes negativas)", () => {
    const st = programSessionStates(services, { ultra: 99 })
    expect(st.find((s) => s.serviceId === "ultra")!.sessionsUsed).toBe(4)
    expect(st.find((s) => s.serviceId === "ultra")!.sessionsRemaining).toBe(0)
  })
})

describe("programAllScheduled", () => {
  it("false si queda alguna por agendar", () => {
    expect(programAllScheduled(programSessionStates(services, { ultra: 4, vela: 4 }))).toBe(false)
  })
  it("true cuando no queda ninguna", () => {
    expect(programAllScheduled(programSessionStates(services, { ultra: 4, vela: 4, up: 6 }))).toBe(true)
  })
})

describe("programRemainingTotal", () => {
  it("suma las restantes de todos los servicios", () => {
    expect(programRemainingTotal(programSessionStates(services, { ultra: 1, up: 2 }))).toBe(3 + 4 + 4)
  })
})

describe("programSchedulableServices", () => {
  it("sólo los servicios con sesiones por agendar", () => {
    const sch = programSchedulableServices(programSessionStates(services, { ultra: 4, vela: 1 }))
    expect(sch.map((s) => s.serviceId)).toEqual(["vela", "up"])
  })
})
