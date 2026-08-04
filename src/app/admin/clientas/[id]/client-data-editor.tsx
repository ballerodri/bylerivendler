"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateClient } from "../../actions"

type Client = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  date_of_birth: string | null
  notes: string | null
  marketing_consent: boolean
}

export default function ClientDataEditor({ client }: { client: Client }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Un email placeholder (`admin_created_…@noemail.local`) es "sin email": se
  // muestra vacío para no ensuciar el campo, y si se deja así no se toca.
  const emailInicial = client.email.toLowerCase().endsWith("@noemail.local") ? "" : client.email

  const [f, setF] = useState({
    firstName: client.first_name,
    lastName: client.last_name,
    email: emailInicial,
    phone: client.phone ?? "",
    // La columna DATE vuelve como "YYYY-MM-DD": entra tal cual al <input type=date>.
    dob: client.date_of_birth ?? "",
    notes: client.notes ?? "",
    marketingConsent: client.marketing_consent,
  })
  const set = (k: keyof typeof f, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }))
    setSaved(false)
  }

  const guardar = () => {
    setError(null)
    if (!f.firstName.trim() || !f.lastName.trim()) {
      setError("El nombre y el apellido son obligatorios.")
      return
    }
    start(async () => {
      const r = await updateClient(client.id, {
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.email || undefined,
        phone: f.phone || undefined,
        dob: f.dob || undefined,
        notes: f.notes || undefined,
        marketingConsent: f.marketingConsent,
      })
      if (r.ok) {
        setSaved(true)
        router.refresh() // el nombre del título se actualiza con el dato nuevo
      } else {
        setError(r.error ?? "No se pudo guardar")
      }
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24, maxWidth: 560 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="adm-label">Nombre *</label>
          <input className="adm-input" style={{ width: "100%" }} value={f.firstName} disabled={pending}
            onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div>
          <label className="adm-label">Apellido *</label>
          <input className="adm-input" style={{ width: "100%" }} value={f.lastName} disabled={pending}
            onChange={(e) => set("lastName", e.target.value)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="adm-label">Teléfono</label>
          <input className="adm-input" style={{ width: "100%" }} value={f.phone} disabled={pending}
            inputMode="tel" onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className="adm-label">Cumpleaños</label>
          <input className="adm-input" style={{ width: "100%" }} type="date" value={f.dob} disabled={pending}
            onChange={(e) => set("dob", e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="adm-label">Email</label>
        <input className="adm-input" style={{ width: "100%" }} type="email" value={f.email} disabled={pending}
          placeholder="Sin email cargado" onChange={(e) => set("email", e.target.value)} />
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="adm-label">Notas internas</label>
        <textarea className="adm-input" style={{ width: "100%", minHeight: 70, resize: "vertical" }}
          value={f.notes} disabled={pending} onChange={(e) => set("notes", e.target.value)} />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={f.marketingConsent} disabled={pending}
          onChange={(e) => set("marketingConsent", e.target.checked)} style={{ width: 16, height: 16 }} />
        Acepta recibir novedades por email
      </label>

      {error && <p role="alert" style={{ fontSize: 13, color: "#8c463c", marginTop: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center" }}>
        <button className="adm-btn adm-btn--primary" onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
      </div>
    </div>
  )
}
