/**
 * Wire-level types shared between the documents UI and the
 * `/api/v1/mining/document-intelligence` endpoint family.
 *
 * Keep this file free of React / RN imports so it can be exercised by
 * the node-only vitest harness without a JSDOM stub.
 */

export type DocumentKind = 'contract' | 'rfp' | 'letter' | 'report' | 'other'

export type IngestionStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface UploadedDocument {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly fileUrl: string
  readonly kind: DocumentKind
  readonly ingestionStatus: IngestionStatus
  readonly ingestionError: string | null
  readonly ingestedAt: string | null
  readonly tags: ReadonlyArray<string>
  readonly createdAt: string
  readonly createdBy: string | null
}

export interface UploadResult {
  readonly documentId: string
  readonly ingestionStatus: IngestionStatus
  readonly kind: DocumentKind
  readonly presignedPut: string
  readonly document: UploadedDocument
}

export interface DocumentSession {
  readonly id: string
  readonly tenantId: string
  readonly userId: string
  readonly title: string | null
  readonly documentIds: ReadonlyArray<string>
  readonly initialPrompt: string | null
  readonly status: 'active' | 'archived'
  readonly createdAt: string
  readonly lastMessageAt: string | null
}

export interface AskResponse {
  readonly sessionId: string
  readonly question: string
  readonly language: 'sw' | 'en'
  readonly evidenceIds: ReadonlyArray<string>
  readonly documentIds: ReadonlyArray<string>
  readonly answer: string | null
}

export interface SummaryResponse {
  readonly documentId: string
  readonly kind: DocumentKind
  readonly language: 'sw' | 'en'
  readonly summary: string
  readonly evidenceIds: ReadonlyArray<string>
}

export const ALLOWED_MIMES: ReadonlyArray<string> = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
  'image/webp',
]

export const MAX_FILE_BYTES = 25 * 1024 * 1024

/** Pure validation helper — used by both the UI and the test harness. */
export function validateUpload(input: {
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
}): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (!input.fileName || input.fileName.length === 0) {
    return { ok: false, code: 'FILE_NAME_REQUIRED', message: 'Jina la faili linahitajika.' }
  }
  if (!ALLOWED_MIMES.includes(input.mimeType)) {
    return {
      ok: false,
      code: 'MIME_NOT_ALLOWED',
      message: 'Aina za faili zinazoruhusiwa: PDF, DOCX, JPEG, PNG, WEBP.',
    }
  }
  if (input.fileSize <= 0) {
    return { ok: false, code: 'FILE_EMPTY', message: 'Faili ni tupu.' }
  }
  if (input.fileSize > MAX_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: 'Kiasi cha juu ni 25 MB.' }
  }
  return { ok: true }
}

/** Translate an ingestion status into a Swahili-first badge label. */
export function ingestionStatusLabel(status: IngestionStatus, lang: 'sw' | 'en' = 'sw'): string {
  if (lang === 'en') {
    switch (status) {
      case 'queued':
        return 'Queued'
      case 'processing':
        return 'Processing'
      case 'ready':
        return 'Ready'
      case 'failed':
        return 'Failed'
    }
  }
  switch (status) {
    case 'queued':
      return 'Imewekwa kwenye foleni'
    case 'processing':
      return 'Inachakatwa'
    case 'ready':
      return 'Tayari'
    case 'failed':
      return 'Imeshindikana'
  }
}

/** Translate a document kind into a Swahili-first label. */
export function kindLabel(kind: DocumentKind, lang: 'sw' | 'en' = 'sw'): string {
  if (lang === 'en') {
    switch (kind) {
      case 'contract':
        return 'Contract'
      case 'rfp':
        return 'RFP / Tender'
      case 'letter':
        return 'Letter'
      case 'report':
        return 'Report'
      case 'other':
        return 'Other'
    }
  }
  switch (kind) {
    case 'contract':
      return 'Mkataba'
    case 'rfp':
      return 'Zabuni'
    case 'letter':
      return 'Barua'
    case 'report':
      return 'Ripoti'
    case 'other':
      return 'Nyingine'
  }
}
