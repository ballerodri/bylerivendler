"use client"

import { useState, useTransition } from "react"
import { updateClientRecord } from "../../actions"
import type { RecordRow } from "./page"

const ALLERGY_CHIPS = ["Ninguna", "Látex", "Perfumes", "Ácidos", "Níquel", "Frutos secos"]
const SKIN_CHIPS = [
  "Acné activo",
  "Rosácea",
  "Dermatitis",
  "Piel sensible",
  "Melasma",
  "Cicatrices recientes",
  "Ninguna",
]

const EMPTY = {
  allergies: [] as string[],
  allergies_other: "",
  medications_status: "no" as "no" | "si",
  medications_note: "",
  pregnancy: "no" as "no" | "embarazo" | "lactancia",
  skin_conditions: [] as string[],
  alert_flags: [] as string[],
}

export default function RecordEditor({
  clientId,
  record,
}: {
  clientId: string
  record: RecordRow | null
}) {
  const [data, setData] = useState(() =>
    record
      ? {
          allergies: record.allergies,
          allergies_other: record.allergies_other ?? "",
          medications_status: record.medications_status,
          medications_note: record.medications_note ?? "",
          pregnancy: record.pregnancy,
          skin_conditions: record.skin_conditions,
          alert_flags: record.alert_flags,
        }
      : EMPTY
  )
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const toggle = (key: "allergies" | "skin_conditions", value: string) => {
    setData((d) => ({
      ...d,
      [key]: d[key].includes(value)
        ? d[key].filter((v) => v !== value)
        : [...d[key], value],
    }))
  }

  const save = () => {
    setError(null)
    setStatus("idle")
    startTransition(async () => {
      const r = await updateClientRecord(clientId, {
        allergies: data.allergies,
        allergies_other: data.allergies_other || null,
        medications_status: data.medications_status,
        medications_note: data.medications_note || null,
        pregnancy: data.pregnancy,
        skin_conditions: data.skin_conditions,
        alert_flags: data.alert_flags,
      })
      if (r.ok) setStatus("saved")
      else {
        setError(r.error ?? "Error")
        setStatus("error")
      }
    })
  }

  const Chips = ({
    options,
    value,
    onToggle,
  }: {
    options: string[]
    value: string[]
    onToggle: (v: string) => void
  }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onToggle(o)}
          className="adm-btn"
          style={
            value.includes(o)
              ? { background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)" }
              : {}
          }
        >
          {o}
        </button>
      ))}
    </div>
  )

  return (
    <div className="adm-card" style={{ padding: 16 }}>
      <Field label="Alergias">
        <Chips
          options={ALLERGY_CHIPS}
          value={data.allergies}
          onToggle={(v) => toggle("allergies", v)}
        />
        <input
          className="adm-input"
          style={{ width: "100%", marginTop: 8 }}
          value={data.allergies_other}
          onChange={(e) => setData({ ...data, allergies_other: e.target.value })}
          placeholder="Otra (opcional)"
        />
      </Field>

      <Field label="Medicación">
        <select
          className="adm-select"
          value={data.medications_status}
          onChange={(e) =>
            setData({
              ...data,
              medications_status: e.target.value as "no" | "si",
            })
          }
        >
          <option value="no">No toma</option>
          <option value="si">Sí toma</option>
        </select>
        {data.medications_status === "si" && (
          <input
            className="adm-input"
            style={{ width: "100%", marginTop: 8 }}
            value={data.medications_note}
            onChange={(e) => setData({ ...data, medications_note: e.target.value })}
            placeholder="¿Cuál?"
          />
        )}
      </Field>

      <Field label="Embarazo / lactancia">
        <select
          className="adm-select"
          value={data.pregnancy}
          onChange={(e) =>
            setData({
              ...data,
              pregnancy: e.target.value as "no" | "embarazo" | "lactancia",
            })
          }
        >
          <option value="no">No aplica</option>
          <option value="embarazo">Embarazo</option>
          <option value="lactancia">Lactancia</option>
        </select>
      </Field>

      <Field label="Condiciones de piel">
        <Chips
          options={SKIN_CHIPS}
          value={data.skin_conditions}
          onToggle={(v) => toggle("skin_conditions", v)}
        />
      </Field>

      <div
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button className="adm-btn adm-btn--primary" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : record ? "Guardar nueva versión" : "Crear ficha"}
        </button>
        {status === "saved" && (
          <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>
        )}
        {status === "error" && (
          <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="adm-row__label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}
