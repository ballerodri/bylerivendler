import type { Metadata } from "next"
import { estadoCalendario } from "@/lib/servicios/adviento"
import { isActiveStaffSession } from "@/lib/staff"
import AdvientoClient from "./adviento-client"
import "./adviento.css"

/**
 * El Calendario de Adviento: `bylerivendler.com/adviento`.
 *
 * Es una acción de un mes y se entra por el link que reparte el salón, así que
 * no se indexa en Google.
 */

export const dynamic = "force-dynamic" // la fecha manda: nunca una copia guardada

export const metadata: Metadata = {
  title: "Calendario de Adviento",
  description: "24 sorpresas de By Leri Vendler. Elegí un número y descubrí la tuya.",
  robots: { index: false, follow: false },
}

export default async function AdvientoPage() {
  const real = estadoCalendario()
  // Modo prueba: el salón puede recorrer el calendario entero antes del 1 de
  // diciembre (y después del 31) para ver cómo quedó. Sólo con sesión del
  // panel: para cualquier otra persona la fecha manda.
  const esStaff = real === "abierto" ? false : await isActiveStaffSession()
  const estado = esStaff ? "abierto" : real

  return (
    <div className="adv">
      <div className="adv__wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="adv__logo" src="/assets/logo-crop.png" alt="By Leri Vendler" />

        <header className="adv__head">
          <span className="adv__kicker">Diciembre</span>
          <h1 className="adv__title">Calendario de Adviento</h1>
          <p className="adv__sub">
            {estado === "antes"
              ? "24 sorpresas para tu piel. Arranca el 1 de diciembre."
              : estado === "terminado"
                ? "Terminó el 31 de diciembre. ¡Gracias por jugar!"
                : "Detrás de cada número hay una sorpresa. Elegís una sola."}
          </p>
        </header>

        {esStaff && (
          <p className="adv__fine" style={{ textAlign: "center" }}>
            Lo estás viendo en modo prueba porque entraste al panel. Para el resto, el calendario
            {real === "antes" ? " arranca el 1 de diciembre" : " ya terminó"}. Las jugadas que hagas se
            guardan de verdad: borralas después desde Adviento.
          </p>
        )}

        {estado === "antes" || estado === "terminado" ? (
          <div className="adv__card">
            <p className="adv__fine" style={{ textAlign: "center" }}>
              {estado === "antes"
                ? "Volvé el 1 de diciembre, elegí tu número y descubrí qué te toca."
                : "Las sorpresas se podían usar hasta el 31 de diciembre."}
            </p>
            <a className="adv__btn adv__btn--ghost" href="/reserva">
              Ver turnos disponibles
            </a>
          </div>
        ) : (
          <AdvientoClient puedeElegir={estado === "abierto"} />
        )}

        <footer className="adv__foot">
          <span>Sanguinetti 297 · Villa Morra, Pilar</span>
          <span>Una sorpresa por persona. Válida hasta el 31 de diciembre.</span>
        </footer>
      </div>
    </div>
  )
}
