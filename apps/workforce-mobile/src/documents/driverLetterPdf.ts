/**
 * Minimal, dependency-free PDF builder for the driver transport letter
 * (W-M-20). React Native has no `expo-print` in this app, so we emit a
 * standards-compliant single-page PDF by hand: a Catalog → Pages → Page
 * tree with one Helvetica font and a single content stream of `Tj`
 * text-show operators. The byte offsets in the xref table are computed
 * from the actual serialized length so the file opens in any reader.
 *
 * This produces REAL bytes that get PUT to the document-store presigned
 * target — nothing here is a placeholder.
 */

import type { Lang } from '../auth/types'
import { pickStrings } from '../i18n'

export interface DriverLetterFields {
  /**
   * Active locale. The letter renders in ONE language only — the Borjie
   * canon forbids EN+SW on a single rendered surface. All labels resolve
   * from the i18n catalog (documents.driverLetter) for this locale.
   */
  readonly lang: Lang
  readonly truckReg: string
  readonly driverName: string
  readonly mineral: string
  readonly tonnage: string
  readonly routeFrom: string
  readonly routeTo: string
  readonly issuedAtIso: string
}

/** Escape the characters that are special inside a PDF string literal. */
function escapePdfText(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/\(/gu, '\\(')
    .replace(/\)/gu, '\\)')
    // Drop non-ASCII so the WinAnsi Helvetica encoding stays valid.
    .replace(/[^\x20-\x7e]/gu, '?')
}

function contentStream(lines: ReadonlyArray<string>): string {
  const startY = 760
  const lineHeight = 22
  const drawn = lines
    .map((line, index) => {
      const y = startY - index * lineHeight
      return `BT /F1 12 Tf 64 ${y} Td (${escapePdfText(line)}) Tj ET`
    })
    .join('\n')
  return `${drawn}\n`
}

/**
 * Build the driver-letter PDF and return its raw bytes. The bytes are
 * Latin-1 encoded (one char === one byte) which matches the PDF body we
 * construct (ASCII operators + WinAnsi text).
 */
export function buildDriverLetterPdf(fields: DriverLetterFields): Uint8Array {
  // Single active locale only (no EN+SW mixing) — every label from the
  // i18n catalog for `fields.lang`.
  const t = pickStrings(fields.lang).documents.driverLetter
  const lines: ReadonlyArray<string> = [
    t.title,
    '',
    `${t.truckReg}: ${fields.truckReg || '-'}`,
    `${t.driver}: ${fields.driverName || '-'}`,
    `${t.mineral}: ${fields.mineral || '-'}`,
    `${t.tonnage}: ${fields.tonnage || '-'}`,
    `${t.routeFrom}: ${fields.routeFrom || '-'}`,
    `${t.routeTo}: ${fields.routeTo || '-'}`,
    '',
    `${t.issued}: ${fields.issuedAtIso}`
  ]

  const stream = contentStream(lines)

  const objects: ReadonlyArray<string> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ' +
      '/Encoding /WinAnsiEncoding >>'
  ]

  const header = '%PDF-1.4\n'
  let body = header
  const offsets: number[] = []
  objects.forEach((obj, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`
  })

  const xrefStart = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`

  const pdf = body + xref + trailer

  // Latin-1 serialization: each code unit maps to a single byte.
  const bytes = new Uint8Array(pdf.length)
  for (let i = 0; i < pdf.length; i += 1) {
    bytes[i] = pdf.charCodeAt(i) & 0xff
  }
  return bytes
}
