export const metadata = {
  title: "Política de privacidad · By Leri Vendler",
  description:
    "Cómo recolectamos, usamos y protegemos tus datos personales en By Leri Vendler.",
}

export default function PrivacidadPage() {
  return (
    <>
      <header className="legal__header">
        <p className="legal__eyebrow">Política de privacidad</p>
        <h1 className="legal__title">
          Cómo cuidamos tu <em>información</em>.
        </h1>
        <p className="legal__updated">Última actualización: mayo 2026</p>
      </header>

      <article className="legal__content">
        <p>
          En By Leri Vendler tomamos en serio tu privacidad. Esta política
          describe qué datos recolectamos, por qué los necesitamos y cómo los
          protegemos. Está alineada con la <strong>Ley 25.326 de Protección de
          Datos Personales</strong> de la República Argentina.
        </p>

        <h2>1. Quiénes somos</h2>
        <p>
          By Leri Vendler es una estética profesional ubicada en Buenos Aires,
          Argentina. El responsable del tratamiento de los datos personales
          recolectados a través de este sitio es la titular del negocio. Para
          consultas relacionadas con tus datos podés escribirnos a{" "}
          <a href="mailto:hola@bylerivendler.com">hola@bylerivendler.com</a>.
        </p>

        <h2>2. Qué datos recolectamos</h2>
        <p>Cuando reservás un turno o creás una cuenta, recolectamos:</p>
        <ul>
          <li>
            <strong>Datos de contacto:</strong> nombre, apellido, email,
            teléfono y fecha de nacimiento.
          </li>
          <li>
            <strong>Ficha clínica/estética:</strong> alergias, medicación
            actual, embarazo o lactancia, condiciones de la piel y antecedentes
            relevantes para el tratamiento.
          </li>
          <li>
            <strong>Historial de turnos y servicios</strong> realizados.
          </li>
          <li>
            <strong>Imágenes antes/después</strong> de tratamientos, solo
            cuando das tu consentimiento explícito.
          </li>
          <li>
            <strong>Datos técnicos básicos</strong> (dirección IP, tipo de
            navegador) para seguridad y prevención de fraude.
          </li>
        </ul>

        <h2>3. Por qué los necesitamos</h2>
        <p>Usamos tus datos exclusivamente para:</p>
        <ul>
          <li>Coordinar y confirmar tus turnos.</li>
          <li>
            Brindarte un tratamiento seguro y personalizado, evitando
            contraindicaciones según tu ficha clínica.
          </li>
          <li>
            Enviarte recordatorios, confirmaciones y comunicaciones relevantes
            sobre tus turnos por email, SMS o WhatsApp.
          </li>
          <li>
            Mantener tu historial estético para el seguimiento de tratamientos
            que requieren múltiples sesiones.
          </li>
          <li>
            Mejorar nuestro servicio y comunicarnos con vos sobre novedades
            (solo si diste tu consentimiento explícito de marketing).
          </li>
        </ul>

        <h2>4. Datos sensibles y consentimiento informado</h2>
        <p>
          Los datos médicos (alergias, medicación, embarazo, condiciones de
          piel) son <strong>datos sensibles</strong> bajo la Ley 25.326. Por
          ello:
        </p>
        <ul>
          <li>
            Solo el equipo profesional autorizado tiene acceso a tu ficha
            clínica.
          </li>
          <li>
            Antes de cada tratamiento te pedimos un consentimiento informado
            digital, donde aceptás explícitamente el procedimiento.
          </li>
          <li>
            Cualquier modificación que hagas a tu ficha queda versionada con
            fecha y hora para trazabilidad clínica.
          </li>
        </ul>

        <h2>5. Con quién compartimos tus datos</h2>
        <p>
          <strong>Nunca vendemos ni cedemos tu información a terceros.</strong>{" "}
          Para operar la plataforma utilizamos los siguientes proveedores, que
          actúan como encargados del tratamiento bajo acuerdos de
          confidencialidad:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> (Estados Unidos / Brasil) — hosting de
            base de datos y autenticación.
          </li>
          <li>
            <strong>Vercel</strong> (Estados Unidos) — hosting del sitio web.
          </li>
          <li>
            <strong>Resend</strong> (Estados Unidos) — envío de emails
            transaccionales.
          </li>
          <li>
            <strong>Google</strong> — autenticación opcional con tu cuenta de
            Google y, en el futuro, sincronización de calendario.
          </li>
          <li>
            <strong>Mercado Pago</strong> — procesamiento de pagos cuando
            corresponda.
          </li>
        </ul>
        <p>
          Estos proveedores procesan tus datos solo para los fines descritos en
          esta política y bajo sus propias políticas de seguridad.
        </p>

        <h2>6. Cuánto tiempo guardamos tus datos</h2>
        <p>
          Conservamos tus datos mientras tu cuenta esté activa y por hasta 5
          años después del último contacto, por motivos contables, legales y de
          seguimiento clínico. Podés solicitar la eliminación anticipada en
          cualquier momento.
        </p>

        <h2>7. Tus derechos</h2>
        <p>Bajo la Ley 25.326 tenés derecho a:</p>
        <ul>
          <li>
            <strong>Acceder</strong> a los datos que tenemos sobre vos.
          </li>
          <li>
            <strong>Rectificar</strong> datos inexactos o desactualizados.
          </li>
          <li>
            <strong>Solicitar la eliminación</strong> total de tu información.
          </li>
          <li>
            <strong>Retirar tu consentimiento</strong> de marketing en cualquier
            momento.
          </li>
          <li>
            <strong>Recibir una copia</strong> de tus datos en formato portable.
          </li>
        </ul>
        <p>
          Para ejercer estos derechos, escribinos a{" "}
          <a href="mailto:hola@bylerivendler.com">hola@bylerivendler.com</a>.
          Respondemos dentro de los 10 días hábiles previstos por la ley.
        </p>

        <h2>8. Seguridad</h2>
        <p>
          Tu información viaja siempre cifrada (HTTPS) y se guarda en bases de
          datos protegidas con Row Level Security, lo que asegura que cada
          clienta sólo accede a sus propios datos. Hacemos backups diarios y
          monitoreamos accesos sospechosos.
        </p>

        <h2>9. Cookies y tecnologías similares</h2>
        <p>
          Usamos cookies esenciales para mantener tu sesión iniciada y
          recordar las preferencias del flujo de reserva. No utilizamos
          cookies de tracking de terceros con fines publicitarios.
        </p>

        <h2>10. Cambios a esta política</h2>
        <p>
          Si actualizamos esta política, te avisamos por email con al menos 30
          días de anticipación si los cambios afectan tus derechos. La fecha de
          última actualización aparece arriba.
        </p>

        <h2>11. Autoridad de control</h2>
        <p>
          La autoridad de control en materia de protección de datos personales
          en Argentina es la <strong>Agencia de Acceso a la Información
          Pública (AAIP)</strong>. Si considerás que no respetamos tus
          derechos, podés presentar un reclamo ante la AAIP.
        </p>
      </article>
    </>
  )
}
