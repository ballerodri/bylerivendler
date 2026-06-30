import "server-only"
import https from "node:https"
import axios from "axios"
import * as soap from "soap"

// Agente HTTPS para todas las conexiones con ARCA/AFIP.
//
// Los servidores de PRODUCCIÓN (servicios1.afip.gov.ar) negocian el cifrado TLS
// con DHE usando una clave Diffie-Hellman de 1024 bits. OpenSSL 3 (Node 17+) la
// rechaza por defecto —nivel de seguridad 2, que exige 2048 bits— con el error:
//
//   error:0A00018A ... tls_process_ske_dhe:dh key too small
//
// Bajamos el nivel de seguridad a 1 SÓLO para ARCA: mantiene forward secrecy
// (DHE-RSA) y acepta la clave de 1024 bits que AFIP sigue usando. El login
// (wsaa.afip.gov.ar) usa ECDHE y funciona sin esto, pero lo aplicamos a todo
// para que sea consistente.
const arcaHttpsAgent = new https.Agent({ ciphers: "DEFAULT@SECLEVEL=1" })

const arcaHttp = axios.create({ httpsAgent: arcaHttpsAgent })

// Crea el cliente SOAP de ARCA. Pasar el cliente axios por `request` aplica el
// agente tanto a la descarga del WSDL como a cada llamada SOAP posterior
// (loginCms, FECompUltimoAutorizado, FECAESolicitar).
export function createArcaSoapClient(url: string): Promise<soap.Client> {
  return soap.createClientAsync(url, { request: arcaHttp })
}
