// Validación del ARMADO de un programa (combo). Pura: la usan createCombo y
// updateCombo (antes NO había validación de servidor — la auditoría lo marcó).
export type ComboServiceInput = { serviceId: string; sessions: number; zoneIds?: string[] }
export type ComboInputShape = {
  name: string
  description?: string
  totalPriceCents: number
  services: ComboServiceInput[]
}

export function validateComboInput(input: ComboInputShape): string | null {
  if (!input.name?.trim()) return "El nombre es obligatorio."
  if (!Number.isFinite(input.totalPriceCents) || input.totalPriceCents <= 0)
    return "Ingresá el precio del programa."
  if (input.services.length < 2) return "Elegí al menos 2 servicios."
  const ids = new Set<string>()
  for (const s of input.services) {
    if (ids.has(s.serviceId)) return "Hay un servicio duplicado en el programa."
    ids.add(s.serviceId)
    if (!Number.isInteger(s.sessions) || s.sessions < 1)
      return "Las sesiones de cada servicio tienen que ser 1 o más (número entero)."
  }
  return null
}
