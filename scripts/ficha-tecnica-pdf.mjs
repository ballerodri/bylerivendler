// Genera docs/ficha-tecnica-consentimiento.html (ficha técnica dermocosmética +
// consentimiento informado, para imprimir y completar a mano en el gabinete).
// Para regenerar el PDF:
//   1) node scripts/ficha-tecnica-pdf.mjs
//   2) chrome --headless --disable-gpu --no-pdf-header-footer \
//        --print-to-pdf=docs/ficha-tecnica-consentimiento.pdf file:///<ruta>/docs/ficha-tecnica-consentimiento.html
import { readFileSync, writeFileSync } from "node:fs"

const logo = readFileSync("public/assets/logo-crop.png").toString("base64")

// ── Helpers de maquetado ──────────────────────────────────────────────────────
const fill = (w = "") => `<span class="fill"${w ? ` style="max-width:${w}"` : ""}></span>`
const cb = () => `<span class="cb"></span>`
const sino = () => `<span class="sino">Sí ${cb()} &nbsp;No ${cb()}</span>`
const row = (label, extra = "") => `<div class="row"><span class="lb">${label}</span>${fill()}${extra}</div>`
const ask = (label) => `<div class="row"><span class="lb grow">${label}</span>${sino()}</div>`
const lines = (n) => Array.from({ length: n }, () => `<div class="line"></div>`).join("")

const zonas = [
  "Labio superior", "Mentón", "Rostro completo", "Cuello",
  "Axilas", "Brazos completos", "Medios brazos", "Manos",
  "Abdomen", "Espalda alta", "Espalda baja", "Pecho",
  "Cavado simple", "Cavado completo", "Glúteos", "Tiro de cola",
  "Piernas completas", "Medias piernas", "Rodillas", "Pies",
]

const html = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>Ficha técnica y consentimiento — By Leri Vendler</title>
<style>
  @page { size: A4; margin: 12mm 13mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #2b2623; font-size: 9.6pt; line-height: 1.5; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #2b2623; padding-bottom: 8px; margin-bottom: 12px; }
  header img { height: 52px; }
  header .t { flex: 1; }
  header h1 { font-size: 14.5pt; font-weight: 500; margin: 0; letter-spacing: 0.01em; }
  header .sub { font-size: 8.6pt; color: #7a6e64; letter-spacing: 0.14em; text-transform: uppercase; }
  header .fecha { font-size: 9.6pt; white-space: nowrap; }

  h2 { font-size: 10pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #5a4a3a;
       border-bottom: 1px solid #e2dacd; padding-bottom: 2px; margin: 12px 0 7px; page-break-after: avoid; }
  .cols2 { column-count: 2; column-gap: 22px; }
  .keep { break-inside: avoid; }

  .row { display: flex; align-items: baseline; gap: 6px; margin: 4.5px 0; }
  .lb { white-space: nowrap; }
  .lb.grow { flex: 1; white-space: normal; }
  .fill { flex: 1; border-bottom: 1px dotted #9c9083; min-width: 40px; height: 12px; }
  .sino { white-space: nowrap; }
  .cb { display: inline-block; width: 9.5pt; height: 9.5pt; border: 1px solid #2b2623; border-radius: 2px; vertical-align: -1.5pt; }
  .line { border-bottom: 1px dotted #9c9083; height: 17px; }
  .muted { color: #7a6e64; font-size: 8.6pt; }
  .opts span { margin-right: 10px; white-space: nowrap; }

  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 10px; }
  .grid .z { display: flex; align-items: center; gap: 5px; }

  .consent p { margin: 0 0 7px; text-align: justify; }
  .consent ol { margin: 0 0 8px; padding-left: 20px; }
  .consent li { margin: 0 0 6px; text-align: justify; }
  .aviso { background: #f6f1ea; border-left: 3px solid #b68a5f; padding: 7px 12px; border-radius: 0 8px 8px 0; margin: 10px 0; }

  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 34px; }
  .firma { text-align: center; }
  .firma .raya { border-bottom: 1px solid #2b2623; height: 34px; margin-bottom: 4px; }
  .firma .quien { font-size: 8.8pt; color: #5a4a3a; }

  footer { margin-top: 14px; border-top: 1px solid #e2dacd; padding-top: 5px; font-size: 8pt; color: #7a6e64;
           display: flex; justify-content: space-between; }
</style>
</head>
<body>

<!-- ── PÁGINA 1: datos + salud ─────────────────────────────────────────────── -->
<div class="page">
  <header>
    <img src="data:image/png;base64,${logo}" alt="By Leri Vendler">
    <div class="t">
      <div class="sub">By Leri Vendler · Estética &amp; Aparatología</div>
      <h1>Ficha técnica para tratamientos dermocosméticos</h1>
    </div>
    <div class="fecha">Fecha: ......../......../............</div>
  </header>

  <h2>Datos personales</h2>
  <div class="row"><span class="lb">Apellido y nombre:</span>${fill()}<span class="lb">DNI:</span>${fill("120px")}</div>
  <div class="row"><span class="lb">Fecha de nacimiento:</span>${fill("110px")}<span class="lb">Profesión / ocupación:</span>${fill()}</div>
  <div class="row"><span class="lb">Dirección:</span>${fill()}<span class="lb">Localidad:</span>${fill("150px")}</div>
  <div class="row"><span class="lb">Teléfono / celular:</span>${fill("160px")}<span class="lb">Email:</span>${fill()}</div>
  <div class="row"><span class="lb">Procedimiento a realizar:</span>${fill()}</div>
  <div class="row"><span class="lb">¿Por qué considera realizar este procedimiento?</span>${fill()}</div>

  <h2>Salud</h2>
  <div class="cols2">
    <div class="keep">
      ${ask("¿Estuvo bajo tratamiento dermatológico en los últimos 5 años?")}
      ${ask("¿Se realizó alguna cirugía en los últimos 12 meses?")}
      ${row("¿De qué tipo?")}
      <div class="row"><span class="lb grow" style="font-weight:600">¿Tiene o tuvo alguno de los siguientes diagnósticos?</span></div>
      ${ask("Respiratorios")}
      ${ask("Diabetes")}
      ${ask("Problemas cardíacos")}
      ${ask("Hipertensión")}
      ${ask("Celiaquía")}
      ${ask("Epilepsia")}
      ${ask("Renales")}
      ${ask("Hepáticos")}
      ${ask("Oncológicos")}
      ${ask("Tiroides (hipo/hipertiroidismo)")}
      ${ask("Várices")}
      ${ask("Herpes recurrente")}
      ${ask("Tendencia a cicatrización queloide")}
    </div>
    <div class="keep">
      ${ask("¿Tiene marcapasos?")}
      ${ask("¿Prótesis o implantes metálicos?")}
      ${ask("¿Implantes dentales?")}
      ${ask("¿Toma medicamentos habitualmente?")}
      <div class="muted">Marcar: anticoagulantes · betabloqueantes · hipertensivos · diuréticos · corticoides · isotretinoína (Roacután) · fotosensibilizantes · vitaminas · suplementos · adelgazantes · otros</div>
      ${row("¿Cuáles?")}
      ${lines(1)}
      ${ask("¿Tomó antibióticos recientemente?")}
      ${ask("¿Es alérgica/o a algún medicamento o sustancia?")}
      ${row("¿Cuáles?")}

      <div class="row" style="margin-top:8px"><span class="lb grow" style="font-weight:600">Mujeres</span></div>
      ${ask("¿Utiliza anticonceptivos orales o DIU hormonal?")}
      ${ask("¿Está embarazada o en lactancia?")}
      ${row("Embarazos / partos (cuántos y condiciones)")}
      ${ask("¿Observó cambios en su piel en embarazo o lactancia?")}
      ${ask("¿Se tiñe el pelo?")}
      ${row("Tipo de tintura y fecha de la última")}
      ${ask("¿Realiza depilación?")}
      ${row("Tipo y fecha de la última")}

      <div class="row" style="margin-top:8px"><span class="lb grow" style="font-weight:600">Hombres</span></div>
      <div class="row"><span class="lb">Método de afeitado:</span><span class="opts">Eléctrico ${cb()} &nbsp;Manual ${cb()}</span></div>
      ${ask("¿Experimenta irritación en la piel del rostro?")}
      ${row("¿Utiliza productos cosméticos? ¿Cuáles?")}
    </div>
  </div>

  <footer><span>By Leri Vendler · Sanguinetti 297, Pilar (B1629), Buenos Aires</span><span>Página 1 de 3</span></footer>
</div>

<!-- ── PÁGINA 2: evaluación profesional + hábitos + zonas ──────────────────── -->
<div class="page">
  <header>
    <img src="data:image/png;base64,${logo}" alt="By Leri Vendler">
    <div class="t">
      <div class="sub">By Leri Vendler · Estética &amp; Aparatología</div>
      <h1>Evaluación profesional</h1>
    </div>
    <div class="fecha muted">Completa la profesional</div>
  </header>

  <h2>Características de la piel</h2>
  <div class="cols2">
    <div class="keep">
      <div class="row"><span class="lb">Fototipo:</span><span class="opts">I ${cb()} II ${cb()} III ${cb()} IV ${cb()} V ${cb()} VI ${cb()}</span></div>
      <div class="row"><span class="lb">Tipo de piel:</span><span class="opts">Normal ${cb()} Seca ${cb()} Grasa ${cb()} Mixta ${cb()}</span></div>
      <div class="row"><span class="lb">Textura:</span><span class="opts">Suave ${cb()} Rugosa ${cb()} Delgada ${cb()} Gruesa ${cb()}</span></div>
      <div class="row"><span class="lb">Poros:</span><span class="opts">Dilatados ${cb()} Normales ${cb()} Cerrados ${cb()}</span></div>
      ${row("Líneas de expresión")}
      ${row("Manchas / discromías")}
      ${row("Vascularización")}
      ${row("Presencia de acné / comedones")}
    </div>
    <div class="keep">
      ${row("Sensibilidad")}
      ${row("Nivel de hidratación")}
      ${row("Nivel de oleosidad")}
      ${ask("¿Tiene alguna afección en la piel?")}
      ${row("¿Cuál?")}
      ${ask("¿Tuvo cáncer de piel?")}
      ${row("Qué tratamiento tuvo y hace cuánto")}
      ${row("Productos faciales que utiliza habitualmente")}
      ${lines(1)}
    </div>
  </div>

  <h2>Alergias y hábitos personales</h2>
  <div class="row"><span class="lb">Elementos a los que tiene reacción alérgica:</span>${fill()}</div>
  <div class="cols2">
    <div class="keep">
      ${ask("¿Fuma?")}
      ${ask("¿Hace actividad física regularmente?")}
      ${row("¿Cuál?")}
    </div>
    <div class="keep">
      ${row("Nivel de estrés (1 a 10)", "")}
      ${ask("¿Se expuso al sol / cama solar en los últimos 15 días?")}
      ${ask("¿Tiene tatuajes en la zona a tratar?")}
    </div>
  </div>
  <div class="row"><span class="lb">Expectativas sobre el tratamiento a realizar:</span>${fill()}</div>
  ${lines(1)}

  <h2>Zonas a tratar</h2>
  <div class="grid">
    ${zonas.map((z) => `<div class="z">${cb()} <span>${z}</span></div>`).join("\n    ")}
  </div>
  <div class="row" style="margin-top:6px"><span class="lb">Otras:</span>${fill()}</div>

  <h2>Observaciones de la profesional</h2>
  ${lines(3)}

  <footer><span>By Leri Vendler · Sanguinetti 297, Pilar (B1629), Buenos Aires</span><span>Página 2 de 3</span></footer>
</div>

<!-- ── PÁGINA 3: consentimiento informado ──────────────────────────────────── -->
<div class="page consent">
  <header>
    <img src="data:image/png;base64,${logo}" alt="By Leri Vendler">
    <div class="t">
      <div class="sub">By Leri Vendler · Estética &amp; Aparatología</div>
      <h1>Consentimiento informado — Tratamientos estéticos y de aparatología</h1>
    </div>
  </header>

  <p>Yo, ................................................................................, DNI .................................., en pleno uso de mis facultades, declaro que:</p>

  <ol>
    <li>He sido informada/o de manera clara y comprensible sobre la <strong>naturaleza del tratamiento</strong> a realizar
        (........................................................................................................), el equipamiento utilizado, la cantidad estimada de
        sesiones, sus alcances y alternativas. Entiendo que <strong>los resultados varían según cada persona</strong> y que no es
        posible garantizar un resultado determinado.</li>
    <li>Se me informaron los <strong>posibles efectos transitorios</strong> del tratamiento (enrojecimiento, sensación de calor,
        sensibilidad, leve inflamación u otras reacciones leves y pasajeras en la zona tratada) y sus
        <strong>contraindicaciones</strong>, y declaro no encontrarme dentro de ellas.</li>
    <li>La información de salud consignada en la ficha técnica adjunta es <strong>veraz y completa</strong>. Me comprometo a
        <strong>informar cualquier cambio</strong> en mi estado de salud o medicación antes de cada sesión — en particular:
        embarazo o búsqueda de embarazo, lactancia, nueva medicación (especialmente fotosensibilizante o
        isotretinoína), tatuajes o lesiones en la zona a tratar, y exposición solar reciente.</li>
    <li>Recibí y comprendí las <strong>indicaciones previas y posteriores</strong> al tratamiento, y me comprometo a cumplirlas.
        Entiendo que su incumplimiento puede afectar los resultados o aumentar la probabilidad de efectos no deseados.</li>
    <li>Tuve la oportunidad de <strong>hacer preguntas</strong> y todas fueron respondidas de manera satisfactoria.</li>
    <li>Los datos personales aquí consignados serán tratados de forma <strong>confidencial</strong>, conforme a la Ley 25.326 de
        Protección de Datos Personales, y utilizados únicamente con fines vinculados a mi atención.</li>
  </ol>

  <div class="aviso">
    <div class="row"><span class="lb grow"><strong>Registro fotográfico:</strong> autorizo el registro fotográfico de la zona a tratar (antes / después) para seguimiento clínico interno.</span>${sino()}</div>
    <div class="row"><span class="lb grow">Autorizo además su uso en redes sociales de By Leri Vendler, <strong>sin identificar mi rostro ni mi nombre</strong>.</span>${sino()}</div>
  </div>

  <p>Habiendo leído y comprendido lo anterior, <strong>presto mi consentimiento</strong> para la realización del tratamiento.</p>

  <p style="margin-top:14px">Lugar y fecha: ......................................................................., ......../......../............</p>

  <div class="firmas">
    <div class="firma">
      <div class="raya"></div>
      <div class="quien">Firma de la clienta / cliente</div>
      <div class="row"><span class="lb">Aclaración:</span>${fill()}</div>
      <div class="row"><span class="lb">DNI:</span>${fill()}</div>
    </div>
    <div class="firma">
      <div class="raya"></div>
      <div class="quien">Firma y sello de la profesional</div>
      <div class="row"><span class="lb">Aclaración:</span>${fill()}</div>
    </div>
  </div>

  <footer><span>By Leri Vendler · Sanguinetti 297, Pilar (B1629), Buenos Aires · Instagram @ByLeriVendler · WhatsApp 11 3364 3359</span><span>Página 3 de 3</span></footer>
</div>

</body>
</html>`

writeFileSync("docs/ficha-tecnica-consentimiento.html", html)
console.log("✓ docs/ficha-tecnica-consentimiento.html generado")
