"use client"

import { useRef, useState, useTransition } from "react"
import { uploadClientPhoto, deleteClientPhoto, togglePhotoVisibility } from "../../actions"

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
  const [preview, setPreview] = useState<string | null>(null)
  const [type, setType] = useState<"before" | "after">("before")
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) { setPreview(null); return }
    setPreview(URL.createObjectURL(f))
  }

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { setError("Seleccioná una foto primero"); return }
    setError(null)
    const fd = new FormData()
    fd.set("file", file)
    fd.set("type", type)
    startTransition(async () => {
      const r = await uploadClientPhoto(clientId, fd)
      if (r.ok) {
        setPreview(null)
        if (fileRef.current) fileRef.current.value = ""
      } else {
        setError(r.error ?? "Error al subir")
      }
    })
  }

  const handleDelete = (photoId: string) => {
    if (!window.confirm("¿Eliminar esta foto? No se puede deshacer.")) return
    startTransition(async () => {
      await deleteClientPhoto(photoId, clientId)
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
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: "var(--ink-mute)", display: "block", marginBottom: 4 }}>Archivo</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={handleFileChange}
              style={{ fontSize: 13, width: "100%" }}
            />
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <button
              className="adm-btn adm-btn--primary"
              onClick={handleUpload}
              disabled={pending || !preview}
            >
              {pending ? "Subiendo…" : "Subir foto"}
            </button>
          </div>
        </div>

        {preview && (
          <div style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Vista previa"
              style={{ height: 120, width: "auto", borderRadius: 8, objectFit: "cover" }}
            />
          </div>
        )}

        {error && (
          <p role="alert" style={{ fontSize: 12, color: "#8c463c", marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
