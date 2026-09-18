"use client"

/**
 * La paleta de Google Calendar (sus 11 colores oficiales) y los círculos para
 * elegir uno. Presentacional: no guarda nada — quien lo usa decide qué hacer
 * con el cambio (el personal guarda al instante; el servicio guarda con el
 * resto del formulario).
 *
 * Vive acá para que la paleta esté en UN solo lugar: la usan la ficha del
 * personal y la de cada servicio.
 */
export const CALENDAR_COLORS: { id: string; name: string; hex: string }[] = [
  { id: "1",  name: "Lavanda",    hex: "#7986CB" },
  { id: "2",  name: "Salvia",     hex: "#33B679" },
  { id: "3",  name: "Uva",        hex: "#8E24AA" },
  { id: "4",  name: "Flamingo",   hex: "#E67C73" },
  { id: "5",  name: "Banana",     hex: "#F6BF26" },
  { id: "6",  name: "Mandarina",  hex: "#F4511E" },
  { id: "7",  name: "Pavo real",  hex: "#039BE5" },
  { id: "8",  name: "Grafito",    hex: "#616161" },
  { id: "9",  name: "Arándano",   hex: "#3F51B5" },
  { id: "10", name: "Albahaca",   hex: "#0B8043" },
  { id: "11", name: "Tomate",     hex: "#D50000" },
]

export function calendarColorName(colorId: string | null): string | null {
  return CALENDAR_COLORS.find((c) => c.id === colorId)?.name ?? null
}

export function calendarColorHex(colorId: string | null): string | null {
  return CALENDAR_COLORS.find((c) => c.id === colorId)?.hex ?? null
}

export default function CalendarColorSwatches({
  value,
  onChange,
  disabled = false,
  /** Texto del círculo "sin color" (el primero). */
  noneLabel = "Sin color",
}: {
  value: string | null
  onChange: (colorId: string | null) => void
  disabled?: boolean
  noneLabel?: string
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <button
        type="button"
        title={noneLabel}
        aria-label={noneLabel}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        disabled={disabled}
        style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "#e5dac9",
          border: value === null ? "3px solid var(--ink)" : "2px solid transparent",
          cursor: disabled ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--ink-mute)" }}>—</span>
      </button>

      {CALENDAR_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.name}
          aria-label={c.name}
          aria-pressed={value === c.id}
          onClick={() => onChange(c.id)}
          disabled={disabled}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: c.hex,
            border: value === c.id ? "3px solid var(--ink)" : "2px solid transparent",
            outline: value === c.id ? `2px solid ${c.hex}` : "none",
            outlineOffset: 2,
            cursor: disabled ? "default" : "pointer",
          }}
        />
      ))}
    </div>
  )
}
