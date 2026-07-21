"use client"

import { useState, useTransition } from "react"
import { uploadClientPhoto, deleteClientPhoto, togglePhotoVisibility } from "../../actions"
import { DropZone, Previews, filtrarImagenes, type Elegida } from "./image-picker"

type Photo = {
  id: string
  storage_path: string
  type: "before" | "after"
  visible_to_client: boolean
  signedUrl: string
}

export default function PhotosManager({
  clientId,
  photos,
}: {
  clientId: string
  photos: Photo[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<"before" | "after">("before")
  // Varias fotos elegidas a la vez, cada una con su vista previa.
  const [elegidas, setElegidas] = useState<Elegida[]>([])
  const [progreso, setProgreso] = useState<string | null>(null)

  // Suma las fotos elegidas (por clic o arrastradas) a las que ya había,
  // descartando lo que no sea imagen.
  const agregarArchivos = (files: FileList | null | undefined) => {
    const { validas, huboInvalida } = filtrarImagenes(files)
    // Soltar algo que no traía archivos (un texto, un link) no puede borrar el
    // error que quedó de un intento anterior.
    if (!validas.length && !huboInvalida) return
    setError(huboInvalida ? "Algún archivo no era una imagen y se descartó." : null)
    if (validas.length) setElegidas((prev) => [...prev, ...validas])
  }

  const quitarElegida = (url: string) => {
    setElegidas((prev) => prev.filter((e) => e.url !== url))
    URL.revokeObjectURL(url)
  }

  const handleUpload = () => {
    if (!elegidas.length) { setError("Elegí al menos una foto"); return }
    setError(null)
    const aSubir = elegidas
    startTransition(async () => {
      const fallidas: { file: File; url: string }[] = []
      for (let i = 0; i < aSubir.length; i++) {
        setProgreso(`Subiendo ${i + 1} de ${aSubir.length}…`)
        const fd = new FormData()
        fd.set("file", aSubir[i].file)
        fd.set("type", type)
        const r = await uploadClientPhoto(clientId, fd)
        if (r.ok) URL.revokeObjectURL(aSubir[i].url)
        else fallidas.push(aSubir[i])
      }
      setProgreso(null)
      // Las que subieron se van; quedan sólo las que fallaron, para reintentar.
      setElegidas(fallidas)
      if (fallidas.length) setError(`${fallidas.length} foto(s) no se pudieron subir. Probá de nuevo.`)
    })
  }

  const handleDelete = (photoId: string) => {
    if (!window.confirm("¿Eliminar esta foto? No se puede deshacer.")) return
    startTransition(async () => {
      // Se muestra el error: si el archivo no se pudo borrar del almacenamiento
      // la foto sigue ahí, y sin este aviso el clic parecía no hacer nada.
      const r = await deleteClientPhoto(photoId, clientId)
      if (!r.ok) setError(r.error ?? "No se pudo eliminar la foto")
    })
  }

  const handleToggle = (photoId: string, current: boolean) => {
    startTransition(async () => {
      await togglePhotoVisibility(photoId, clientId, !current)
    })
  }

  return (
    <div>
      {/* Gallery */}
      {photos.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                background: "var(--linen)",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid rgba(43,38,35,0.08)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.signedUrl}
                alt={p.type === "before" ? "Antes" : "Después"}
                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
              />
              <div style={{ padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      color: p.type === "before" ? "#7a6e64" : "var(--gold)",
                    }}
                  >
                    {p.type === "before" ? "Antes" : "Después"}
                  </span>
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={pending}
                    style={{
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
                </div>
                <button
                  onClick={() => handleToggle(p.id, p.visible_to_client)}
                  disabled={pending}
                  className={`adm-btn ${p.visible_to_client ? "adm-btn--primary" : ""}`}
                  style={{ width: "100%", fontSize: 11 }}
                >
                  {p.visible_to_client ? "Visible para la clienta" : "Mostrar a la clienta"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {photos.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--ink-mute)", marginBottom: 20 }}>
          Todavía no hay fotos para esta clienta.
        </p>
      )}

      {/* Upload form */}
      <div className="adm-card" style={{ padding: 16 }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-soft)", margin: "0 0 12px" }}>
          Subir foto
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--ink-mute)", display: "block", marginBottom: 4 }}>Tipo</label>
            <select
              className="adm-select"
              value={type}
              onChange={(e) => setType(e.target.value as "before" | "after")}
            >
              <option value="before">Antes</option>
              <option value="after">Después</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ fontSize: 11, color: "var(--ink-mute)", display: "block", marginBottom: 4 }}>Fotos</label>
            <DropZone
              onFiles={agregarArchivos}
              titulo={elegidas.length ? "Tocá para agregar más" : "Tocá para elegir fotos"}
              subtitulo="podés elegir varias, o arrastrarlas hasta acá"
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
                ? `Subir ${elegidas.length} fotos`
                : "Subir foto"}
            </button>
          </div>
        </div>

        {/* Las fotos elegidas todavía sin subir, con su tache para quitarlas. */}
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
