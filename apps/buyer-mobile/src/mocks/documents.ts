import type { SaleDocument } from '@/types/document'

export const mockDocuments: readonly SaleDocument[] = [
  {
    id: 'doc-001',
    title: 'Sale contract · Chunya doré',
    counterparty: 'Chunya Gold Refinery',
    listingId: 'lst-006',
    pdfUrl: 'https://example.com/contracts/doc-001.pdf',
    status: 'pending_signature',
    issuedAt: '2026-05-23T08:00:00Z',
    signedAt: null,
    totalTzs: 1_689_600_000
  },
  {
    id: 'doc-002',
    title: 'Off-take MoU · Mbozi copper',
    counterparty: 'Mbozi Mining Cooperative',
    listingId: 'lst-004',
    pdfUrl: 'https://example.com/contracts/doc-002.pdf',
    status: 'pending_signature',
    issuedAt: '2026-05-22T14:20:00Z',
    signedAt: null,
    totalTzs: 627_200_000
  },
  {
    id: 'doc-003',
    title: 'Sale contract · Geita gold Q1',
    counterparty: 'Nyamulilima Cooperative',
    listingId: null,
    pdfUrl: 'https://example.com/contracts/doc-003.pdf',
    status: 'signed',
    issuedAt: '2026-04-08T09:00:00Z',
    signedAt: '2026-04-09T12:42:00Z',
    totalTzs: 412_000_000
  },
  {
    id: 'doc-004',
    title: 'KYC declaration · 2026',
    counterparty: 'Borjie Compliance',
    listingId: null,
    pdfUrl: 'https://example.com/contracts/doc-004.pdf',
    status: 'signed',
    issuedAt: '2026-01-14T10:00:00Z',
    signedAt: '2026-01-14T10:08:00Z',
    totalTzs: 0
  }
] as const

export function findDocument(id: string): SaleDocument | undefined {
  return mockDocuments.find((doc) => doc.id === id)
}
