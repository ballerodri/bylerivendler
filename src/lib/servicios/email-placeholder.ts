// El salón guarda un email "de relleno" (`admin_created_…@noemail.local`) para
// las clientas que no dejaron uno real: la columna `email` es NOT NULL, así que
// "sin email" se representa con ese placeholder. Nunca se le manda nada ahí.
// Estas funciones lo tratan como "sin email" para MOSTRAR y para DECIDIR, así
// el placeholder no se le escapa a la usuaria en ninguna pantalla.

export function esEmailPlaceholder(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase()
  return !e || e.endsWith("@noemail.local")
}

/** El email para mostrar/usar: vacío si es placeholder o no hay uno real. */
export function emailParaMostrar(email: string | null | undefined): string {
  return esEmailPlaceholder(email) ? "" : (email ?? "").trim()
}
