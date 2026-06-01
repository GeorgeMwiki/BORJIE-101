'use client';

/**
 * In-chat document upload bridge — full binary loop.
 *
 * Makes the home-chat `file_request_card` REAL: when the owner attaches a
 * file and submits we register it with the gateway's document-intelligence
 * pipeline, ship the bytes to object storage, and reflect the outcome back
 * into the transcript.
 *
 * Two flows, picked by mime:
 *
 *   TEXT (text/*) — we read the first 4 KB client-side and forward it as
 *   `textSample`. The gateway runs SYNCHRONOUS, schema-guided field
 *   extraction over that sample and returns `extraction.fieldCount`, so the
 *   chat note reads "Uploaded <name> — extracted N fields". No binary PUT is
 *   needed (the sample is enough to seed extraction).
 *
 *   BINARY (pdf / docx / images) — no client-readable sample, so extraction
 *   is DEFERRED to the async OCR worker. That worker only runs once the raw
 *   bytes are in storage AND the row is flipped to `ingestion_status='ready'`.
 *   We therefore:
 *     1. POST metadata to `/upload` → `{ documentId, presignedPut, presigned }`.
 *     2. POST the File to `presignedPut` (Supabase signed-upload URL — see
 *        `uploadBinaryToSignedUrl` for the exact wire contract). XHR gives us
 *        real byte-level progress; the token is embedded in the URL so NO
 *        Authorization header is sent.
 *     3. POST `/documents/:id/ready` (authed) to flip the status so the
 *        worker OCRs it.
 *   On success the chat note reads "Uploaded <name> — processing" (async OCR
 *   pending); the field count fills in later when the worker finishes.
 *
 * GRACEFUL EVERYWHERE: a client-side reject, the presign degrading
 * (Supabase env unwired → no real URL), a PUT failure, a ready-flip failure,
 * a network drop, an HTTP 4xx/5xx, or a wire-format drift all resolve to
 * `{ ok: false, … }` with a locale-pure reason key. The upload row already
 * exists server-side, so the owner can retry from the docs tab — we never
 * crash the chat bubble and never lose the row.
 *
 * Transport: the shared `apiRequest` client forwards the Supabase bearer +
 * session cookie and unwraps the `{ success, data }` envelope for the gateway
 * calls. The presigned upload is a DIRECT-to-storage POST (not through the
 * gateway), so it bypasses `apiRequest` entirely. All responses are
 * zod-parsed (defence in depth).
 *
 * Per CLAUDE.md: immutable, no console.log, zod on responses, functions
 * < 50 lines, all user copy via `i18n/strings/doc-upload` (zero Swahili here).
 */

import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';
import { validateUpload } from '@/documents/types';
import type { DocUploadKey } from '@/i18n/strings/doc-upload';

const UPLOAD_PATH = '/api/v1/mining/document-intelligence/upload';
const readyPath = (id: string): string =>
  `/api/v1/mining/document-intelligence/documents/${id}/ready`;

/** Mime prefixes we can sample text from client-side to seed extraction. */
const TEXT_SAMPLEABLE = ['text/'];
const TEXT_SAMPLE_BYTES = 4096;
/** Generous ceiling for a direct-to-storage upload of a 25 MB scan. */
const BINARY_PUT_TIMEOUT_MS = 120_000;

/** The extraction summary the gateway returns when a textSample was sent. */
const extractionSummarySchema = z.object({
  extractionId: z.string(),
  schemaId: z.string(),
  fieldCount: z.number().int().nonnegative(),
  overallConfidence: z.number(),
});

/** The presign block the gateway attaches for the direct storage upload. */
const presignedSchema = z.object({
  headers: z.record(z.string()).default({}),
  degraded: z.boolean().default(false),
});

/**
 * Upload-registration response. Only the fields the loop consumes are
 * required; zod's default strip mode ignores the richer `document` payload so
 * a future shape never rejects. `presignedPut` is the absolute signed-upload
 * URL; absent/empty means the gateway could not mint one (degraded).
 */
const uploadResponseSchema = z.object({
  documentId: z.string(),
  ingestionStatus: z.string(),
  kind: z.string().optional(),
  extraction: extractionSummarySchema.nullable().default(null),
  presignedPut: z.string().optional().default(''),
  presigned: presignedSchema.optional(),
});

/** The `/documents/:id/ready` response — confirms the status flip. */
const readyResponseSchema = z.object({
  documentId: z.string(),
  ingestionStatus: z.string(),
});

/** Discriminated result so the caller renders the right transcript note. */
export type DocUploadOutcome =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly documentId: string;
      /** Field count for the synchronous text path; `null` when extraction
       *  is deferred to the async OCR worker (binary "processing" note). */
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

/** Per-file byte progress for the binary PUT (0..1), surfaced to the card. */
export type DocUploadProgress = (done: number, total: number, fraction: number) => void;

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
 * POST the raw File to a Supabase Storage SIGNED-UPLOAD URL.
 *
 * The gateway minted `presignedPut` via `createSignedUploadUrl`, whose wire
 * contract is a `POST` of `multipart/form-data` to
 * `…/storage/v1/object/upload/sign/<bucket>/<path>?token=<jwt>` — the token
 * lives in the query string, so NO Authorization header is sent (a stray
 * bearer would actually be rejected). The body mirrors the storage-js
 * `uploadToSignedUrl` form: a `cacheControl` field + the File in the
 * empty-named field. We use XHR (not fetch) purely for `upload.onprogress`,
 * which fetch cannot surface. Resolves true on a 2xx, false otherwise — never
 * throws, so the caller degrades to a graceful note.
 */
function uploadBinaryToSignedUrl(args: {
  readonly url: string;
  readonly file: File;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', args.file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', args.url, true);
    xhr.timeout = BINARY_PUT_TIMEOUT_MS;
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) args.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.onabort = () => resolve(false);
    if (args.signal) {
      if (args.signal.aborted) {
        xhr.abort();
        return;
      }
      args.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** Build the metadata POST body for `/upload`. */
function buildUploadBody(file: File, textSample: string) {
  return {
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    ...(textSample.length > 0 ? { textSample } : {}),
  };
}

/** Flip the registered doc to `ready` so the async OCR worker picks it up. */
async function markDocumentReady(
  documentId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const raw = await apiRequest<unknown>(readyPath(documentId), {
      method: 'POST',
      ...(signal ? { signal } : {}),
    });
    return readyResponseSchema.safeParse(raw).success;
  } catch {
    return false;
  }
}

/**
 * Run the binary leg (PUT bytes → flip ready) after registration. Returns the
 * transcript outcome: a `processing` success (`fieldCount: null`) once the
 * worker has been triggered, or a graceful failure that keeps the row.
 */
async function completeBinaryUpload(args: {
  readonly file: File;
  readonly documentId: string;
  readonly presignedPut: string;
  readonly degraded: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}): Promise<DocUploadOutcome> {
  const { file, documentId } = args;
  // No real signed URL (Supabase env unwired) → bytes can't reach storage, so
  // OCR can never run. Surface a clear note but keep the registered row.
  if (args.degraded || args.presignedPut.length === 0) {
    return { ok: false, fileName: file.name, reasonKey: 'reasonStorageUnavailable' };
  }
  const put = await uploadBinaryToSignedUrl({
    url: args.presignedPut,
    file,
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
  if (!put) {
    return { ok: false, fileName: file.name, reasonKey: 'reasonStoragePutFailed' };
  }
  const ready = await markDocumentReady(documentId, args.signal);
  if (!ready) {
    return { ok: false, fileName: file.name, reasonKey: 'reasonReadyFailed' };
  }
  return { ok: true, fileName: file.name, documentId, fieldCount: null };
}

/**
 * Register one attached file with the gateway and drive it to a terminal
 * transcript outcome. Never throws to the UI (see module docstring).
 */
export async function uploadChatDocument(
  file: File,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
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
  try {
    const raw = await apiRequest<unknown>(UPLOAD_PATH, {
      method: 'POST',
      body: buildUploadBody(file, textSample),
      ...(signal ? { signal } : {}),
    });
    const parsed = uploadResponseSchema.parse(raw);

    // Text path: extraction already ran synchronously server-side. Even when
    // it returned nothing we acknowledge the upload (fieldCount may be null).
    if (textSample.length > 0) {
      return {
        ok: true,
        fileName: file.name,
        documentId: parsed.documentId,
        fieldCount: parsed.extraction ? parsed.extraction.fieldCount : null,
      };
    }

    // Binary path: push the bytes to storage and trigger the async OCR worker.
    return completeBinaryUpload({
      file,
      documentId: parsed.documentId,
      presignedPut: parsed.presignedPut,
      degraded: parsed.presigned?.degraded ?? false,
      ...(signal ? { signal } : {}),
      ...(onProgress ? { onProgress } : {}),
    });
  } catch (error) {
    const detail =
      error instanceof ApiError || error instanceof Error ? error.message : undefined;
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
 * Sequential (not parallel) keeps gateway + storage load predictable and lets
 * the progress callback render a clean "document N/total" counter plus the
 * in-flight file's byte fraction.
 */
export async function uploadChatDocuments(
  files: ReadonlyArray<File>,
  onProgress?: DocUploadProgress,
  signal?: AbortSignal,
): Promise<ReadonlyArray<DocUploadOutcome>> {
  const total = files.length;
  const outcomes: DocUploadOutcome[] = [];
  for (let i = 0; i < total; i += 1) {
    const file = files[i];
    if (!file) continue;
    const outcome = await uploadChatDocument(file, signal, (fraction) =>
      onProgress?.(i, total, fraction),
    );
    outcomes.push(outcome);
    onProgress?.(i + 1, total, 0);
  }
  return outcomes;
}
