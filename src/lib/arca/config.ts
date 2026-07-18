import "server-only"

export type ArcaEnv = "homologacion" | "produccion"

export interface ArcaConfig {
  env: ArcaEnv
  cuit: string
  ptoVta: number
  cert: string
  key: string
  wsaaUrl: string
  wsfeUrl: string
  padronUrl: string
  emisor: {
    razonSocial: string
    domicilio: string
    inicioActividades: string
    iibb: string
  }
}

const URLS = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL",
    // Padrón A13 (ws_sr_padron_a13): consulta de datos de una persona.
    padron: "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL",
    padron: "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL",
  },
} as const

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Falta la variable de entorno ${name}`)
  return v
}

export function getArcaConfig(): ArcaConfig {
  const env = (process.env.ARCA_ENV ?? "homologacion") as ArcaEnv
  return {
    env,
    cuit: required("ARCA_CUIT"),
    ptoVta: Number(required("ARCA_PTO_VTA")),
    // En Vercel los saltos de línea del PEM van escapados como \n
    cert: required("ARCA_CERT").replace(/\\n/g, "\n"),
    key: required("ARCA_KEY").replace(/\\n/g, "\n"),
    wsaaUrl: URLS[env].wsaa,
    wsfeUrl: URLS[env].wsfe,
    padronUrl: URLS[env].padron,
    emisor: {
      razonSocial: process.env.ARCA_RAZON_SOCIAL ?? "By Leri Vendler",
      domicilio: process.env.ARCA_DOMICILIO ?? "",
      inicioActividades: process.env.ARCA_INICIO_ACTIVIDADES ?? "",
      iibb: process.env.ARCA_IIBB ?? "Exento",
    },
  }
}
