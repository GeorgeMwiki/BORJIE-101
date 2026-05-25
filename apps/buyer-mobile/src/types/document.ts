export type DocStatus = 'pending_signature' | 'signed' | 'expired' | 'rejected'

export interface SaleDocument {
  readonly id: string
  readonly title: string
  readonly counterparty: string
  readonly listingId: string | null
  readonly pdfUrl: string
  readonly status: DocStatus
  readonly issuedAt: string
  readonly signedAt: string | null
  readonly totalTzs: number
}
