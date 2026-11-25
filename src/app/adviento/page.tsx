import type { Metadata } from "next"
import { estadoCalendario, casilleroDeHoy } from "@/lib/servicios/adviento"
import { isActiveStaffSession } from "@/lib/staff"
import { flagPrendido, ADVIENTO_PRUEBA } from "@/lib/app-settings"
import { ADDRESS_LINE, ADDRESS_AREA } from "@/lib/location"
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
  // Dos maneras de abrirlo fuera de diciembre, las dos para probar:
  //  · el interruptor del panel, que lo abre para CUALQUIERA que tenga el link
  //    (para mirarlo en otro celular, o mostrárselo a alguien);
  //  · tener sesión del panel, que alcanza para mirarlo una misma.
  const prueba = real === "abierto" ? false : await flagPrendido(ADVIENTO_PRUEBA)
  const esStaff = real === "abierto" || prueba ? false : await isActiveStaffSession()
  const estado = prueba || esStaff ? "abierto" : real

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
                : "Cada día se abre una esfera distinta. Abrís una sola, y no sabés qué hay detrás."}
          </p>
        </header>

        {(prueba || esStaff) && (
          <p className="adv__fine" style={{ textAlign: "center" }}>
            {prueba
              ? "Esto es una prueba: el salón dejó el calendario abierto a mano."
              : "Lo estás viendo en modo prueba porque entraste al panel."}{" "}
            {real === "antes"
              ? "Para el resto, la elección arranca el 1 de diciembre."
              : real === "solo-canje"
                ? "Para el resto, la elección cerró el 24, pero quien ya jugó puede ver su premio y usarlo hasta el 31."
                : "Para el resto, el calendario ya terminó."}{" "}
            Las jugadas que se hagan se guardan de verdad: bórralas después desde Adviento.
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
          <AdvientoClient puedeElegir={estado === "abierto"} casilleroHoy={casilleroDeHoy()} />
        )}

        <footer className="adv__foot">
          <span>{ADDRESS_LINE} · {ADDRESS_AREA}</span>
          <span>Una sorpresa por persona. Válida hasta el 31 de diciembre.</span>
        </footer>
      </div>
    </div>
  )
}
