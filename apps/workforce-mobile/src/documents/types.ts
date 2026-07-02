/**
 * Wire-level types shared between the documents UI and the
 * `/api/v1/mining/document-intelligence` endpoint family.
 *
 * Keep this file free of React / RN imports so it can be exercised by
 * the node-only vitest harness without a JSDOM stub. (`StringDict` is a
 * TYPE-only import — erased at compile, no runtime i18n/JSON pulled in.)
 */
import type { StringDict } from '../i18n'

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
  // `message` is a DEV/LOG string only (English) — the UI never renders it: the
  // caller (DocumentUploadButton) localizes by the stable `code` through the
  // i18n bundle, so no off-locale string can reach the user via this path.
  if (!input.fileName || input.fileName.length === 0) {
    return { ok: false, code: 'FILE_NAME_REQUIRED', message: 'A file name is required.' }
  }
  if (!ALLOWED_MIMES.includes(input.mimeType)) {
    return {
      ok: false,
      code: 'MIME_NOT_ALLOWED',
      message: 'Allowed file types: PDF, DOCX, JPEG, PNG, WEBP.',
    }
  }
  if (input.fileSize <= 0) {
    return { ok: false, code: 'FILE_EMPTY', message: 'The file is empty.' }
  }
  if (input.fileSize > MAX_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: 'The maximum size is 25 MB.' }
  }
  return { ok: true }
}

/**
 * Resolve an ingestion status into a SINGLE-LOCALE badge label from the i18n
 * catalog. `t` is the active-locale dictionary (from `useI18n().t` /
 * `pickStrings(lang)`) — one source of truth, no inline duplicated strings,
 * no EN+SW mixing. Mirrors the buyer-mobile fix.
 */
export function ingestionStatusLabel(status: IngestionStatus, t: StringDict): string {
  return t.documents.status[status]
}

/**
 * Resolve a document kind into a SINGLE-LOCALE label from the i18n catalog.
 * `t` is the active-locale dictionary. Mirrors the buyer-mobile fix.
 */
export function kindLabel(kind: DocumentKind, t: StringDict): string {
  return t.documents.kind[kind]
}
