'use client';

/**
 * In-chat document upload bridge.
 *
 * Makes the home-chat `file_request_card` REAL: when the owner attaches a
 * file and submits, we register it with the gateway's document-intelligence
 * pipeline (which now runs synchronous, schema-guided field extraction) and
 * reflect the outcome back into the transcript.
 *
 * Endpoint: `POST /api/v1/mining/document-intelligence/upload`. This is the
 * ONLY doc route that returns an `extraction` summary (`fieldCount`), which
 * the chat note ("extracted N fields") needs. The owner `/docs/intake`
 * route persists but does not extract.
 *
 * Transport: the shared `apiRequest` client forwards the Supabase bearer +
 * session cookie and unwraps the gateway's `{ success, data }` envelope —
 * identical to every other owner-web call (`documents/api.ts`). The gateway
 * handler reads JSON (`c.req.json()`); extraction is triggered by a
 * `textSample` field, so for text-extractable files we read the first 4 KB
 * client-side and forward it. Binary types (PDF / images) ship without a
 * sample — the gateway defers their extraction to the async OCR worker and
 * the response carries `extraction: null`.
 *
 * Validation mirrors the gateway: mime against the document-intelligence
 * allowlist + the 25 MB ceiling (via `validateUpload`), so a reject never
 * round-trips. The response is zod-parsed (defence in depth) so a wire-format
 * drift surfaces as a clean error the caller falls back from — never a crash
 * inside the chat bubble.
 *
 * Per CLAUDE.md: immutable, no console.log, zod on the response, functions
 * < 50 lines, all user copy via `i18n/strings/doc-upload` (zero Swahili here).
 */

import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';
import { validateUpload } from '@/documents/types';
import type { DocUploadKey } from '@/i18n/strings/doc-upload';

const UPLOAD_PATH = '/api/v1/mining/document-intelligence/upload';

/** Mime prefixes we can sample text from client-side to seed extraction. */
const TEXT_SAMPLEABLE = ['text/'];
const TEXT_SAMPLE_BYTES = 4096;

/** The extraction summary the gateway returns when a textSample was sent. */
const extractionSummarySchema = z.object({
  extractionId: z.string(),
  schemaId: z.string(),
  fieldCount: z.number().int().nonnegative(),
  overallConfidence: z.number(),
});

/**
 * Upload response — only the fields the chat reflection consumes are
 * required; `extraction` is nullable (binary files defer extraction). Zod's
 * default strip mode ignores the richer `document` / `presignedPut` payload
 * so a future shape never rejects.
 */
const uploadResponseSchema = z.object({
  documentId: z.string(),
  ingestionStatus: z.string(),
  kind: z.string().optional(),
  extraction: extractionSummarySchema.nullable().default(null),
});

/** Discriminated result so the caller renders the right transcript note. */
export type DocUploadOutcome =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly documentId: string;
      readonly fieldCount: number | null;
    }
  | {
      readonly ok: false;
      readonly fileName: string;
      /** A locale-pure reason KEY the caller resolves via `fillDocUpload`. */
      readonly reasonKey: DocUploadKey;
      /** Free-form server detail (already localized upstream or a code). */
      readonly detail?: string;
    };

/** Map the validator's failure code → a locale-pure reason key. */
function reasonKeyForCode(code: string): DocUploadKey {
  switch (code) {
    case 'MIME_NOT_ALLOWED':
      return 'reasonMimeNotAllowed';
    case 'FILE_TOO_LARGE':
      return 'reasonTooLarge';
    case 'FILE_EMPTY':
      return 'reasonEmpty';
    case 'FILE_NAME_REQUIRED':
      return 'reasonNameRequired';
    default:
      return 'reasonUnknown';
  }
}

/** Read the first 4 KB of a text-extractable file; '' for binary/large. */
async function readTextSample(file: File): Promise<string> {
  const sampleable = TEXT_SAMPLEABLE.some((p) => file.type.startsWith(p));
  if (!sampleable) return '';
  try {
    const slice = file.slice(0, TEXT_SAMPLE_BYTES);
    const text = await slice.text();
    return text.slice(0, TEXT_SAMPLE_BYTES);
  } catch {
    return '';
  }
}

/**
 * Register one attached file with the gateway and parse the response.
 *
 * Never throws to the UI: a client-side reject, a network drop, an HTTP
 * 4xx/5xx, or a wire-format drift all resolve to `{ ok: false, … }` with a
 * locale-pure reason key, so the chat bubble degrades to a graceful note
 * (and the caller may keep the text fallback for unknown shapes).
 */
export async function uploadChatDocument(
  file: File,
  signal?: AbortSignal,
): Promise<DocUploadOutcome> {
  const validation = validateUpload({
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });
  if (!validation.ok) {
    return { ok: false, fileName: file.name, reasonKey: reasonKeyForCode(validation.code) };
  }

  const textSample = await readTextSample(file);
  const body = {
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    ...(textSample.length > 0 ? { textSample } : {}),
  };

  try {
    const raw = await apiRequest<unknown>(UPLOAD_PATH, {
      method: 'POST',
      body,
      ...(signal ? { signal } : {}),
    });
    const parsed = uploadResponseSchema.parse(raw);
    return {
      ok: true,
      fileName: file.name,
      documentId: parsed.documentId,
      fieldCount: parsed.extraction ? parsed.extraction.fieldCount : null,
    };
  } catch (error) {
    const detail =
      error instanceof ApiError || error instanceof Error
        ? error.message
        : undefined;
    return {
      ok: false,
      fileName: file.name,
      reasonKey: 'reasonUnknown',
      ...(detail ? { detail } : {}),
    };
  }
}

/**
 * Upload several attached files sequentially, surfacing per-file progress.
 * Sequential (not parallel) keeps gateway load predictable and lets the
 * progress callback render a clean "document N/total" counter.
 */
export async function uploadChatDocuments(
  files: ReadonlyArray<File>,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ReadonlyArray<DocUploadOutcome>> {
  const total = files.length;
  const outcomes: DocUploadOutcome[] = [];
  for (let i = 0; i < total; i += 1) {
    const file = files[i];
    if (!file) continue;
    const outcome = await uploadChatDocument(file, signal);
    outcomes.push(outcome);
    onProgress?.(i + 1, total);
  }
  return outcomes;
}
