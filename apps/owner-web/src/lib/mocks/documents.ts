/**
 * Document store mocks for O-W-04 (Document chat) and O-W-21
 * (Onboarding & data import).
 *
 * The PDF viewer renders a real react-pdf canvas when given a URL, but
 * for the placeholder flow we ship synthetic "pages" with extracted
 * paragraphs so the chat citations highlight specific bboxes.
 */

export interface DocumentChunk {
  readonly id: string;
  readonly page: number;
  readonly bbox: readonly [number, number, number, number];
  readonly text: string;
}

export interface DocumentRecord {
  readonly id: string;
  readonly title: string;
  readonly mineral: 'gold' | 'coltan' | 'tanzanite';
  readonly type: 'PML' | 'EPP' | 'assay' | 'invoice' | 'MoU' | 'audit';
  readonly pages: number;
  readonly uploadedAt: string;
  readonly url: string | null;
  readonly chunks: ReadonlyArray<DocumentChunk>;
}

export const DOCUMENTS_MOCK: ReadonlyArray<DocumentRecord> = [
  {
    id: 'doc_pml_25434_2025',
    title: 'PML 25434 grant — Nyakabale (2023)',
    mineral: 'gold',
    type: 'PML',
    pages: 4,
    uploadedAt: '2024-09-04T10:14:00Z',
    url: null,
    chunks: [
      {
        id: 'chk_1',
        page: 1,
        bbox: [72, 110, 540, 160],
        text:
          'Primary Mining Licence (PML) reference 25434 is granted to Mawe Bora Mining Ltd over an area of 8.7 hectares within the Nyakabale ward, Geita Region.',
      },
      {
        id: 'chk_2',
        page: 2,
        bbox: [72, 220, 540, 268],
        text:
          'Annual rent payable: TZS 1,200,000 per annum. Rent shall be paid within 30 days of the renewal anchor date.',
      },
      {
        id: 'chk_3',
        page: 3,
        bbox: [72, 410, 540, 470],
        text:
          'Dormancy: failure to commence operations within 12 months of grant triggers the dormancy clock per Mining Act 2010 §44.',
      },
    ],
  },
  {
    id: 'doc_pml_25434_2024',
    title: 'PML 25434 grant — Nyakabale (2024 revision)',
    mineral: 'gold',
    type: 'PML',
    pages: 4,
    uploadedAt: '2024-10-12T11:02:00Z',
    url: null,
    chunks: [
      {
        id: 'chk_1b',
        page: 1,
        bbox: [72, 110, 540, 160],
        text:
          'Primary Mining Licence (PML) reference 25434 is granted to Mawe Bora Mining Ltd over an area of 8.7 hectares within the Nyakabale ward, Geita Region. Boundary coordinates updated 2024.',
      },
      {
        id: 'chk_2b',
        page: 2,
        bbox: [72, 220, 540, 268],
        text:
          'Annual rent payable: TZS 1,500,000 per annum (revised). Rent shall be paid within 30 days of the renewal anchor date.',
      },
    ],
  },
  {
    id: 'doc_epp_2025',
    title: 'EPP report — Nyakabale 2025',
    mineral: 'gold',
    type: 'EPP',
    pages: 38,
    uploadedAt: '2025-02-14T08:30:00Z',
    url: null,
    chunks: [
      {
        id: 'chk_epp_1',
        page: 6,
        bbox: [72, 320, 540, 410],
        text:
          'Tailings dam freeboard requirement: minimum 1.0 m. Operator shall maintain weekly inspection records.',
      },
    ],
  },
  {
    id: 'doc_assay_mbeya',
    title: 'Mbeya Ridge — grab sample assay (2025-01)',
    mineral: 'coltan',
    type: 'assay',
    pages: 6,
    uploadedAt: '2025-01-22T16:00:00Z',
    url: null,
    chunks: [
      {
        id: 'chk_as_1',
        page: 2,
        bbox: [60, 180, 560, 260],
        text:
          'Sample MBR-08: Ta2O5 0.18%, Nb2O5 0.11%, Fe 12.4%, density 4.9 g/cc.',
      },
    ],
  },
];

export function getDocumentById(id: string): DocumentRecord | undefined {
  return DOCUMENTS_MOCK.find((d) => d.id === id);
}
