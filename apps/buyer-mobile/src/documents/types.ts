/**
 * Wire-level types shared between the buyer-mobile documents UI and the
 * `/api/v1/mining/document-intelligence` endpoint family.
 *
 * Mirrors `apps/workforce-mobile/src/documents/types.ts` so the two
 * mobile surfaces remain wire-compatible. Kept duplicated rather than
 * shared via a workspace package because the apps have independent
 * vitest configs and mobile-side bundling needs to keep package
 * boundaries tight per the modular-monolith hard rule.
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

export function validateUpload(input: {
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
}): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (!input.fileName || input.fileName.length === 0) {
    return { ok: false, code: 'FILE_NAME_REQUIRED', message: 'A file name is required.' }
  }
  if (!ALLOWED_MIMES.includes(input.mimeType)) {
    return {
      ok: false,
      code: 'MIME_NOT_ALLOWED',
      message: 'Allowed types: PDF, DOCX, JPEG, PNG, WEBP.',
    }
  }
  if (input.fileSize <= 0) {
    return { ok: false, code: 'FILE_EMPTY', message: 'The file is empty.' }
  }
  if (input.fileSize > MAX_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: 'Maximum size is 25 MB.' }
  }
  return { ok: true }
}

export function ingestionStatusLabel(status: IngestionStatus): string {
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

export function kindLabel(kind: DocumentKind): string {
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
