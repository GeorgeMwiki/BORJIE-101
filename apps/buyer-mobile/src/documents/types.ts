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

/**
 * Translator injected by the calling component (the useTranslation `t`).
 * Keeping these helpers locale-driven means status / kind chips obey the
 * active locale instead of hardcoding English — single-language-per-locale
 * by construction.
 */
type Translate = (path: string) => string

export function ingestionStatusLabel(status: IngestionStatus, t: Translate): string {
  switch (status) {
    case 'queued':
      return t('documents.status_queued')
    case 'processing':
      return t('documents.status_processing')
    case 'ready':
      return t('documents.status_ready')
    case 'failed':
      return t('documents.status_failed')
  }
}

export function kindLabel(kind: DocumentKind, t: Translate): string {
  switch (kind) {
    case 'contract':
      return t('documents.kind_contract')
    case 'rfp':
      return t('documents.kind_rfp')
    case 'letter':
      return t('documents.kind_letter')
    case 'report':
      return t('documents.kind_report')
    case 'other':
      return t('documents.kind_other')
  }
}
