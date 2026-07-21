"use client"

import { useState, useTransition } from "react"
import { uploadClientPhoto, deleteClientPhoto, updateClientPhotoNote } from "../../actions"
import { DropZone, Previews, filtrarImagenes, type Elegida } from "./image-picker"

// Las hojas del consentimiento en PAPEL (ficha técnica + consentimiento
// informado, 3 hojas) fotografiadas. Vive en la misma tabla y el mismo bucket
// privado que las fotos, con type='consent', pero en su propia sección: no se
// mezcla con la galería de antes/después y NUNCA se le muestra a la clienta
// (nace visible_to_client=false y el portal además filtra por tipo).

export type ConsentPage = {
  id: string
  storage_path: string
  note: string | null
  created_at: string
  signedUrl: string
}

const TZ = "America/Argentina/Buenos_Aires"

const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ })

export default function ConsentManager({
  clientId,
  pages,
}: {
  clientId: string
  pages: ConsentPage[]
}) {
  const [pending, startTransition] = useTransition()
  // La nota tiene su PROPIA transición: si compartiera `pending` con subir y
  // borrar, guardar la nota al salir del campo deshabilitaría esos botones
  // entre el mousedown y el mouseup y se comería el clic (había que apretar
  // dos veces), además de mostrar "Subiendo…" sin estar subiendo nada.
  const [notaPending, startNota] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [elegidas, setElegidas] = useState<Elegida[]>([])
  const [progreso, setProgreso] = useState<string | null>(null)
  const [borrando, setBorrando] = useState<string | null>(null)
  // Nota tecleada por hoja (lo que se ve mientras se edita) y cuál se acaba de
  // guardar, para el "Guardado ✓".
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [guardada, setGuardada] = useState<string | null>(null)

  const agregarArchivos = (files: FileList | null | undefined) => {
    const { validas, huboInvalida } = filtrarImagenes(files)
    // Soltar algo que no traía archivos no puede borrar el error anterior.
    if (!validas.length && !huboInvalida) return
    setError(huboInvalida ? "Algún archivo no era una imagen y se descartó." : null)
    if (validas.length) setElegidas((prev) => [...prev, ...validas])
  }

  const quitarElegida = (url: string) => {
    setElegidas((prev) => prev.filter((e) => e.url !== url))
    URL.revokeObjectURL(url)
  }

  const handleUpload = () => {
    if (!elegidas.length) { setError("Elegí al menos una hoja"); return }
    setError(null)
    const aSubir = elegidas
    startTransition(async () => {
      const fallidas: Elegida[] = []
      for (let i = 0; i < aSubir.length; i++) {
        setProgreso(`Subiendo ${i + 1} de ${aSubir.length}…`)
        const fd = new FormData()
        fd.set("file", aSubir[i].file)
        fd.set("type", "consent")
        const r = await uploadClientPhoto(clientId, fd)
        if (r.ok) URL.revokeObjectURL(aSubir[i].url)
        else fallidas.push(aSubir[i])
      }
      setProgreso(null)
      // Las que subieron se van; quedan sólo las que fallaron, para reintentar.
      setElegidas(fallidas)
      if (fallidas.length) setError(`${fallidas.length} hoja(s) no se pudieron subir. Probá de nuevo.`)
    })
  }

  const handleDelete = (pageId: string) => {
    setError(null)
    startTransition(async () => {
      const r = await deleteClientPhoto(pageId, clientId)
      if (r.ok) setBorrando(null)
      else setError(r.error ?? "No se pudo eliminar")
    })
  }

  /** Guarda la nota al salir del campo, sólo si cambió. */
  const guardarNota = (page: ConsentPage) => {
    const valor = notas[page.id]
    if (valor === undefined) return
    if (valor.trim() === (page.note ?? "").trim()) return
    setError(null)
    startNota(async () => {
      const r = await updateClientPhotoNote(page.id, clientId, valor)
      // Lo tecleado se CONSERVA (no se borra la clave): si se borrara, hasta
      // que el servidor revalide el campo volvería al texto viejo justo
      // después del "Guardado ✓" y parecería que no se guardó.
      if (r.ok) setGuardada(page.id)
      else setError(r.error ?? "No se pudo guardar la nota")
    })
  }

  return (
    <div>
      {pages.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {pages.map((p) => (
            <div
              key={p.id}
              style={{
                background: "var(--linen)",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid rgba(43,38,35,0.08)",
              }}
            >
              {/* Se abre en pestaña nueva para leerla en grande (la hoja
                  escrita a mano no se lee en una miniatura). */}
              <a href={p.signedUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.signedUrl}
                  alt={p.note || "Hoja del consentimiento"}
                  style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", display: "block" }}
                />
              </a>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 6 }}>
                  Subida el {fmtFecha(p.created_at)}
                </div>

                <input
                  className="adm-input"
                  style={{ width: "100%", fontSize: 12, padding: "6px 8px" }}
                  placeholder="Nota (ej. firmado el 12/07)"
                  // El servidor recorta a 300; el tope acá evita que se corte
                  // en silencio después de decir "Guardado ✓".
                  maxLength={300}
                  value={notas[p.id] ?? p.note ?? ""}
                  disabled={notaPending}
                  onChange={(e) => {
                    setGuardada(null)
                    setNotas((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }}
                  onBlur={() => guardarNota(p)}
                />
                {guardada === p.id && (
                  <span style={{ fontSize: 10, color: "#4d6b3e" }}>Guardado ✓</span>
                )}

                {borrando === p.id ? (
                  <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#8c463c" }}>¿Eliminar esta hoja?</span>
                    <button
                      className="adm-btn adm-btn--danger"
                      style={{ fontSize: 11 }}
                      disabled={pending}
                      onClick={() => handleDelete(p.id)}
                    >
                      Sí, eliminar
                    </button>
                    <button
                      className="adm-btn"
                      style={{ fontSize: 11 }}
                      disabled={pending}
                      onClick={() => setBorrando(null)}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setBorrando(p.id)}
                    disabled={pending}
                    style={{
                      marginTop: 6,
                      fontSize: 10,
                      color: "#8c463c",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--ink-mute)", marginBottom: 20 }}>
          Todavía no subiste la ficha firmada de esta clienta. Se imprime desde{" "}
          <a href="/docs/ficha-tecnica-consentimiento.pdf" target="_blank" rel="noopener noreferrer">
            Ficha técnica + consentimiento (PDF, 3 hojas)
          </a>
          , se completa a mano y después le sacás una foto a cada hoja.
        </p>
      )}

      <div className="adm-card" style={{ padding: 16 }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-soft)", margin: "0 0 12px" }}>
          Subir hojas firmadas
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <DropZone
              icono="📄"
              onFiles={agregarArchivos}
              titulo={elegidas.length ? "Tocá para agregar más hojas" : "Tocá para elegir las hojas"}
              subtitulo="una foto por hoja — podés elegir varias, o arrastrarlas hasta acá"
            />
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <button
              className="adm-btn adm-btn--primary"
              onClick={handleUpload}
              disabled={pending || elegidas.length === 0}
            >
              {pending
                ? (progreso ?? "Subiendo…")
                : elegidas.length > 1
                ? `Subir ${elegidas.length} hojas`
                : "Subir hoja"}
            </button>
          </div>
        </div>

        <Previews items={elegidas} onQuitar={quitarElegida} disabled={pending} />

        {error && (
          <p role="alert" style={{ fontSize: 12, color: "#8c463c", marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
