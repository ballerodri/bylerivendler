"use client"

import { useState, useTransition } from "react"
import { inviteStaff } from "../actions"

export default function StaffForm() {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState("professional")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setOk(false)
    startTransition(async () => {
      const r = await inviteStaff({ email, full_name: name, role })
      if (r.ok) {
        setOk(true)
        setEmail("")
        setName("")
        setRole("professional")
      } else setError(r.error ?? "Error")
    })
  }

  return (
    <div className="adm-card" style={{ padding: 20, marginBottom: 16 }}>
      <h2 style={{ fontFamily: "var(--serif)", fontSize: 16, margin: "0 0 12px" }}>
        Sumar al equipo
      </h2>
      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px auto", gap: 10 }}>
        <input
          className="adm-input"
          style={{ width: "100%" }}
          type="email"
          required
          placeholder="email@ejemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="adm-input"
          style={{ width: "100%" }}
          required
          placeholder="Nombre completo"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="adm-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="admin">Admin</option>
          <option value="professional">Profesional</option>
          <option value="reception">Recepción</option>
        </select>
        <button className="adm-btn adm-btn--primary" type="submit" disabled={pending}>
          {pending ? "Sumando…" : "Sumar"}
        </button>
      </form>
      {ok && (
        <p style={{ fontSize: 12, color: "#4d6b3e", marginTop: 10 }}>
          Listo. Cuando esa persona inicie sesión con ese email, queda con acceso al panel.
        </p>
      )}
      {error && (
        <p style={{ fontSize: 12, color: "#8c463c", marginTop: 10 }}>{error}</p>
      )}
    </div>
  )
}
