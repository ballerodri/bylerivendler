"use client"

import { useState } from "react"

type DepilationData = {
  nombreApellido: string
  zonasTratamiento: string[]
  contraindicaciones: string
  checkboxConsentimiento: boolean
  checkboxIndicaciones: boolean
  checkboxSalud: boolean
  checkboxRegistro: boolean
}

const ZONAS = [
  "Axilas",
  "Cavado",
  "Tira de cola",
  "Piernas completas",
  "Media pierna",
  "Brazos",
  "Rostro",
  "Bozo",
  "Mentón",
  "Abdomen",
  "Espalda",
  "Pecho",
  "Glúteos",
]

const CONSENTIMIENTO_TEXT = `Declaro que se me ha explicado que la depilación definitiva es un procedimiento estético destinado a reducir progresivamente el crecimiento del vello. Comprendo que los resultados varían según fototipo, color y grosor del pelo, zona tratada, edad, factores hormonales, medicación, constancia en las sesiones y respuesta individual.

Se me informó que pueden requerirse varias sesiones y mantenimientos posteriores, ya que el vello crece en diferentes fases y no todos los folículos responden al mismo tiempo.`

const CONTRAINDICACIONES_TEXT = `Declaro haber informado si presento o presenté alguna de las siguientes condiciones: embarazo, lactancia, epilepsia fotosensible, cáncer actual o tratamiento oncológico, marcapasos o implantes electrónicos, diabetes no controlada, enfermedad autoinmune activa, trastornos de coagulación, uso de anticoagulantes, uso reciente de isotretinoína, medicación fotosensibilizante, antibióticos recientes, corticoides, herpes activo en la zona, infecciones, heridas, quemaduras o irritación en la zona, tatuajes en la zona a tratar, bronceado reciente, cama solar reciente, autobronceante reciente, peeling, ácidos o exfoliación intensa reciente.`

const INDICACIONES_PRE = `Declaro haber sido informada/o de que debo:
• Asistir con la zona rasurada según indicación profesional.
• No depilar con cera, pinza, hilo ni sistema que arranque el pelo de raíz durante el tratamiento.
• Evitar exposición solar directa antes de la sesión.
• No usar cama solar ni autobronceantes antes de la sesión.
• Informar si tomé medicación nueva.
• Informar si la piel está irritada, lastimada, brotada o sensibilizada.
• No aplicar ácidos, retinoides o exfoliantes fuertes en la zona antes de la sesión, salvo indicación profesional.`

const REACCIONES_TEXT = `Comprendo que luego de la sesión pueden aparecer reacciones esperables y generalmente transitorias, tales como enrojecimiento, sensación de calor, ardor leve, picazón, inflamación perifolicular, sensibilidad en la zona, sequedad e irritación temporal.

También se me informó que, aunque no es lo habitual, pueden presentarse efectos no deseados como quemaduras, ampollas, manchas hiper o hipopigmentadas, costras, foliculitis, reacciones alérgicas o cambios temporales en la textura de la piel, especialmente si no se cumplen los cuidados indicados o si existen factores individuales predisponentes.`

const INDICACIONES_POST = `Me comprometo a:
• Evitar exposición solar directa posterior a la sesión.
• Usar protector solar en zonas expuestas.
• No rascar, frotar ni exfoliar la zona inmediatamente después.
• No usar ácidos, retinoides, perfumes o productos irritantes en la zona hasta que la piel esté normalizada.
• No realizar cera, pinza o arranque del vello durante el tratamiento.
• Avisar ante cualquier reacción intensa, persistente o inesperada.
• Cumplir los intervalos sugeridos entre sesiones.`

export function DepilationConsent({
  data,
  onChange,
}: {
  data: DepilationData
  onChange: (data: DepilationData) => void
}) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    consentimiento: true,
    contraindicaciones: false,
    indicacionesPre: false,
    reacciones: false,
    indicacionesPost: false,
  })

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleZona = (zona: string) => {
    const next = data.zonasTratamiento.includes(zona)
      ? data.zonasTratamiento.filter((z) => z !== zona)
      : [...data.zonasTratamiento, zona]
    onChange({ ...data, zonasTratamiento: next })
  }

  const toggleCheckbox = (key: keyof Omit<DepilationData, "nombreApellido" | "zonasTratamiento" | "contraindicaciones">) => {
    onChange({ ...data, [key]: !data[key] })
  }

  const isValid =
    data.nombreApellido.trim() &&
    data.zonasTratamiento.length > 0 &&
    data.checkboxConsentimiento &&
    data.checkboxIndicaciones &&
    data.checkboxSalud &&
    data.checkboxRegistro

  const Section = ({
    title,
    sectionKey,
    content,
  }: {
    title: string
    sectionKey: string
    content: string
  }) => (
    <div style={{ marginBottom: 20, borderRadius: 8, border: "1px solid #e0d9d0", overflow: "hidden" }}>
      <button
        onClick={() => toggleSection(sectionKey)}
        style={{
          width: "100%",
          padding: "12px 16px",
          background: "#faf8f6",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 14,
          fontWeight: 500,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {title}
        <span style={{ fontSize: 12 }}>{expandedSections[sectionKey] ? "−" : "+"}</span>
      </button>
      {expandedSections[sectionKey] && (
        <div style={{ padding: "12px 16px", fontSize: 13, lineHeight: 1.6, color: "#4a423d", whiteSpace: "pre-wrap" }}>
          {content}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 600 }}>
      <p style={{ fontSize: 13, color: "#7a6e64", marginBottom: 20 }}>
        <strong>Consentimiento informado para depilación definitiva</strong>
      </p>

      {/* Nombre y Apellido */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8, color: "#3a3530" }}>
          Nombre y apellido
        </label>
        <input
          type="text"
          className="field__input"
          value={data.nombreApellido}
          onChange={(e) => onChange({ ...data, nombreApellido: e.target.value })}
          placeholder="Tu nombre completo"
        />
      </div>

      {/* Zonas */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, color: "#3a3530" }}>
          Zonas a tratar
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {ZONAS.map((zona) => (
            <label
              key={zona}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 8,
                borderRadius: 4,
                cursor: "pointer",
                background: data.zonasTratamiento.includes(zona) ? "#faf8f6" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={data.zonasTratamiento.includes(zona)}
                onChange={() => toggleZona(zona)}
                style={{ cursor: "pointer" }}
              />
              <span style={{ fontSize: 13 }}>{zona}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Secciones colapsables */}
      <Section sectionKey="consentimiento" title="Consentimiento específico" content={CONSENTIMIENTO_TEXT} />
      <Section sectionKey="contraindicaciones" title="Contraindicaciones y advertencias" content={CONTRAINDICACIONES_TEXT} />
      <Section sectionKey="indicacionesPre" title="Indicaciones previas al tratamiento" content={INDICACIONES_PRE} />
      <Section sectionKey="reacciones" title="Posibles reacciones" content={REACCIONES_TEXT} />
      <Section sectionKey="indicacionesPost" title="Indicaciones posteriores" content={INDICACIONES_POST} />

      {/* Contraindicaciones - campo abierto */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8, color: "#3a3530" }}>
          ¿Presentas alguna contraindicación? (opcional)
        </label>
        <textarea
          className="field__input"
          value={data.contraindicaciones}
          onChange={(e) => onChange({ ...data, contraindicaciones: e.target.value })}
          placeholder="Detalla si hay alguna condición relevante..."
          rows={3}
        />
      </div>

      {/* Checkboxes finales */}
      <div style={{ marginBottom: 20, paddingTop: 20, borderTop: "1px solid #e0d9d0" }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={data.checkboxConsentimiento}
              onChange={() => toggleCheckbox("checkboxConsentimiento")}
              style={{ marginTop: 2, cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, lineHeight: 1.4 }}>
              Acepto el consentimiento informado para depilación definitiva.
            </span>
          </label>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={data.checkboxIndicaciones}
              onChange={() => toggleCheckbox("checkboxIndicaciones")}
              style={{ marginTop: 2, cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, lineHeight: 1.4 }}>
              Declaro haber leído y comprendido las indicaciones pre y post tratamiento.
            </span>
          </label>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={data.checkboxSalud}
              onChange={() => toggleCheckbox("checkboxSalud")}
              style={{ marginTop: 2, cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, lineHeight: 1.4 }}>
              Declaro que la información de salud brindada es verdadera y completa.
            </span>
          </label>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={data.checkboxRegistro}
              onChange={() => toggleCheckbox("checkboxRegistro")}
              style={{ marginTop: 2, cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, lineHeight: 1.4 }}>
              Autorizo el registro de evolución del tratamiento en mi ficha.
            </span>
          </label>
        </div>
      </div>

      {/* Validación */}
      {!isValid && (
        <p style={{ fontSize: 12, color: "#8c463c", marginBottom: 16 }}>
          ⚠ Completá todos los campos y checkboxes para continuar.
        </p>
      )}

      <div style={{ opacity: isValid ? 1 : 0.5, pointerEvents: isValid ? "auto" : "none" }}>
        <button
          className="btn btn--primary"
          style={{ width: "100%" }}
          disabled={!isValid}
        >
          Continuar
        </button>
      </div>
    </div>
  )
}
