"use client"

import { useRef, useState } from "react"

// Piezas compartidas por los dos subidores de la ficha (fotos antes/después y
// hojas del consentimiento en papel): la misma zona para tocar/arrastrar y la
// misma tira de vistas previas. El ESTADO vive en cada subidor — acá sólo está
// lo presentacional y el filtrado de archivos.

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]

export type Elegida = { file: File; url: string }

/**
 * Separa lo que es imagen de lo que no. Las válidas ya vienen con su URL de
 * vista previa: hay que revocarla (URL.revokeObjectURL) al quitarlas o cuando
 * terminan de subir, para no dejar memoria colgada.
 */
export function filtrarImagenes(
  files: FileList | null | undefined
): { validas: Elegida[]; huboInvalida: boolean } {
  if (!files || !files.length) return { validas: [], huboInvalida: false }
  const validas: Elegida[] = []
  let huboInvalida = false
  for (const f of Array.from(files)) {
    // Algunos navegadores no informan el type: en ese caso se deja pasar y lo
    // valida el servidor/bucket.
    if (f.type && !ACCEPTED_IMAGE_TYPES.includes(f.type)) {
      huboInvalida = true
      continue
    }
    validas.push({ file: f, url: URL.createObjectURL(f) })
  }
  return { validas, huboInvalida }
}

/**
 * Zona grande: se toca para elegir del dispositivo (en el celular abre la
 * cámara/galería y deja elegir VARIAS) o se le arrastran imágenes encima. El
 * <input type=file multiple> queda oculto detrás.
 */
export function DropZone({
  onFiles,
  icono = "📷",
  titulo,
  subtitulo,
}: {
  onFiles: (files: FileList | null | undefined) => void
  icono?: string
  titulo: string
  subtitulo: string
}) {
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "18px 14px",
          border: `1.5px dashed ${dragOver ? "var(--gold)" : "var(--line)"}`,
          borderRadius: 10,
          background: dragOver ? "var(--rose-wash, #f6e9de)" : "#fff",
          cursor: "pointer",
          textAlign: "left",
          transition: "border-color .15s, background .15s",
        }}
      >
        <span style={{ fontSize: 22, lineHeight: 1 }}>{icono}</span>
        <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          {titulo}
          <br />
          <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>{subtitulo}</span>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        onChange={(e) => {
          onFiles(e.target.files)
          // Se limpia para poder volver a elegir el MISMO archivo si hace falta.
          if (fileRef.current) fileRef.current.value = ""
        }}
        style={{ display: "none" }}
      />
    </>
  )
}

/** Las imágenes elegidas todavía sin subir, cada una con su tache. */
export function Previews({
  items,
  onQuitar,
  disabled,
}: {
  items: Elegida[]
  onQuitar: (url: string) => void
  disabled: boolean
}) {
  if (!items.length) return null
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      {items.map((e) => (
        <div key={e.url} style={{ position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={e.url}
            alt="Vista previa"
            style={{ height: 72, width: 72, borderRadius: 8, objectFit: "cover", display: "block" }}
          />
          {!disabled && (
            <button
              type="button"
              onClick={() => onQuitar(e.url)}
              aria-label="Quitar"
              style={{
                position: "absolute", top: -6, right: -6, width: 20, height: 20,
                borderRadius: "50%", border: "none", background: "#2b2623", color: "#fff",
                fontSize: 12, lineHeight: 1, cursor: "pointer", display: "grid", placeItems: "center",
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
