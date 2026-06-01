/**
 * Wire-level types shared between the owner-web document-intelligence
 * UI and `/api/v1/mining/document-intelligence`.
 *
 * Mirrors the mobile-side types so the four surfaces stay wire-
 * compatible. Kept duplicated rather than centralised in a workspace
 * package because the apps have independent vitest configs and tight
 * package boundaries per the modular-monolith hard rule.
 */

import { tailStrings as S } from '@/i18n/strings/tail';

export type DocumentKind = 'contract' | 'rfp' | 'letter' | 'report' | 'other';

export type IngestionStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface UploadedDocument {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly fileUrl: string;
  readonly kind: DocumentKind;
  readonly ingestionStatus: IngestionStatus;
  readonly ingestionError: string | null;
  readonly ingestedAt: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface UploadResult {
  readonly documentId: string;
  readonly ingestionStatus: IngestionStatus;
  readonly kind: DocumentKind;
  readonly presignedPut: string;
  readonly document: UploadedDocument;
}

export interface DocumentSession {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly title: string | null;
  readonly documentIds: ReadonlyArray<string>;
  readonly initialPrompt: string | null;
  readonly status: 'active' | 'archived';
  readonly createdAt: string;
  readonly lastMessageAt: string | null;
}

export interface AskResponse {
  readonly sessionId: string;
  readonly question: string;
  readonly language: 'sw' | 'en';
  readonly evidenceIds: ReadonlyArray<string>;
  readonly documentIds: ReadonlyArray<string>;
  readonly answer: string | null;
}

export interface SummaryResponse {
  readonly documentId: string;
  readonly kind: DocumentKind;
  readonly language: 'sw' | 'en';
  readonly summary: string;
  readonly evidenceIds: ReadonlyArray<string>;
}

export const ALLOWED_MIMES: ReadonlyArray<string> = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function validateUpload(input: {
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
}):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  if (!input.fileName || input.fileName.length === 0) {
    return { ok: false, code: 'FILE_NAME_REQUIRED', message: 'A file name is required.' };
  }
  if (!ALLOWED_MIMES.includes(input.mimeType)) {
    return {
      ok: false,
      code: 'MIME_NOT_ALLOWED',
      message: 'Allowed types: PDF, DOCX, JPEG, PNG, WEBP.',
    };
  }
  if (input.fileSize <= 0) {
    return { ok: false, code: 'FILE_EMPTY', message: 'The file is empty.' };
  }
  if (input.fileSize > MAX_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: 'Maximum size is 25 MB.' };
  }
  return { ok: true };
}

export function ingestionStatusLabel(
  status: IngestionStatus,
  lang: 'sw' | 'en' = 'sw',
): string {
  const t = S.documentTypes;
  switch (status) {
    case 'queued':
      return t.statusQueued[lang];
    case 'processing':
      return t.statusProcessing[lang];
    case 'ready':
      return t.statusReady[lang];
    case 'failed':
      return t.statusFailed[lang];
  }
}

export function kindLabel(kind: DocumentKind, lang: 'sw' | 'en' = 'sw'): string {
  const t = S.documentTypes;
  switch (kind) {
    case 'contract':
      return t.kindContract[lang];
    case 'rfp':
      return t.kindRfp[lang];
    case 'letter':
      return t.kindLetter[lang];
    case 'report':
      return t.kindReport[lang];
    case 'other':
      return t.kindOther[lang];
  }
}
