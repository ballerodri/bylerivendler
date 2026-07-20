import "server-only"
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import QRCode from "qrcode"
import { fmtMoneyCents } from "./format"
import { etiquetaCondicionIva } from "./padron-parse"

export interface InvoicePdfData {
  emisor: {
    razonSocial: string
    cuit: string
    domicilio: string
    inicioActividades: string
    iibb: string
  }
  /** 11 = Factura C, 13 = Nota de Crédito C. */
  cbteTipo: number
  ptoVta: number
  nro: number
  fecha: string // dd/mm/yyyy
  cae: string
  caeVto: string // dd/mm/yyyy
  receptorDoc: string
  receptorNombre: string
  /** Código RG 5616 realmente informado a ARCA (ver `padron-parse.ts`). */
  receptorCondIva: number
  descripcion: string
  totalCents: number
  qrUrl: string
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#2b2623" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1 solid #2b2623", paddingBottom: 10, marginBottom: 14 },
  emisor: { maxWidth: 280 },
  razon: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  small: { fontSize: 9, color: "#4a423d", marginBottom: 2 },
  compBox: { alignItems: "flex-end" },
  tipo: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: "#7a6e64", textTransform: "uppercase", marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottom: "1 solid #eae2d7" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  total: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 24, borderTop: "1 solid #2b2623", paddingTop: 10 },
  qr: { width: 90, height: 90 },
  cae: { fontSize: 9, textAlign: "right" },
})

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const qrPng = await QRCode.toDataURL(data.qrUrl, { margin: 1, width: 220 })
  const nroFmt = String(data.nro).padStart(8, "0")
  const ptoFmt = String(data.ptoVta).padStart(4, "0")
  const totalFmt = fmtMoneyCents(data.totalCents)

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.emisor}>
            <Text style={styles.razon}>{data.emisor.razonSocial}</Text>
            <Text style={styles.small}>CUIT: {data.emisor.cuit}</Text>
            <Text style={styles.small}>{data.emisor.domicilio}</Text>
            <Text style={styles.small}>Responsable Monotributo</Text>
            <Text style={styles.small}>Ingresos Brutos: {data.emisor.iibb}</Text>
            <Text style={styles.small}>Inicio de actividades: {data.emisor.inicioActividades}</Text>
          </View>
          <View style={styles.compBox}>
            <Text style={styles.tipo}>{data.cbteTipo === 13 ? "NOTA DE CRÉDITO C" : "FACTURA C"}</Text>
            <Text style={styles.small}>Cód. {data.cbteTipo === 13 ? "013" : "011"}</Text>
            <Text style={styles.small}>N° {ptoFmt}-{nroFmt}</Text>
            <Text style={styles.small}>Fecha: {data.fecha}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Receptor</Text>
          <Text>{data.receptorNombre}</Text>
          <Text style={styles.small}>{data.receptorDoc}</Text>
          {/* Tiene que decir EXACTAMENTE la condición que se le informó a ARCA:
              si el papel dice una cosa y el CAE registra otra, el comprobante
              entregado contradice al fiscal. Antes acá había un "Consumidor
              Final" fijo, que dejó de ser cierto cuando la condición empezó a
              salir del padrón. */}
          <Text style={styles.small}>
            Condición IVA: {etiquetaCondicionIva(data.receptorCondIva) ?? "Consumidor Final"}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text>{data.descripcion}</Text>
            <Text>{totalFmt}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.total}>Total: {totalFmt}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image style={styles.qr} src={qrPng} />
          <View>
            <Text style={styles.cae}>CAE: {data.cae}</Text>
            <Text style={styles.cae}>Vto. CAE: {data.caeVto}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
