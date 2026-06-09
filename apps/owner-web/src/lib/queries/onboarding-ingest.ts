'use client';

/**
 * Owner-onboarding REAL-row bridge.
 *
 * LANE B1 — closes the onboarding launch blocker. The five-step wizard
 * (`app/(routes)/onboarding/page.tsx`) used to send only file NAMES
 * (`{ name }`) to the orchestrator `/start /advance /complete` verbs, which
 * persist a run-state row + a `cockpit_seed` jsonb of COUNTS — but never a
 * single domain row. A paying owner who dropped licence PDFs finished at
 * `status=complete` with an EMPTY cockpit.
 *
 * This module bridges the wizard onto the REAL row-creating path that the
 * api-gateway already exposes (NO backend change here):
 *
 *   1. UPLOAD BYTES + OCR — for each picked document we drive the real
 *      document-intelligence binary loop:
 *        a. POST `/mining/document-intelligence/upload` (metadata) → mints a
 *           Supabase signed-upload URL + a `documentId`.
 *        b. POST the raw File to that signed URL (direct-to-storage; the token
 *           rides the query string so NO Authorization header is sent).
 *        c. POST `/mining/document-intelligence/documents/:id/ready` (authed,
 *           CSRF via the shared client) to flip `ingestion_status='ready'`,
 *           which triggers the async OCR worker.
 *        d. Poll GET `/mining/document-intelligence/documents/:id/extraction`
 *           until the worker has written an `ocr_extractions` row, capturing
 *           its `id` — the `ocr_extraction_id` the recipe `/commit` needs.
 *
 *   2. COMMIT — per captured `ocr_extraction_id`, POST
 *      `/mining/onboarding/commit` with the resolved `entity_type`. The recipe
 *      pipeline inserts REAL, idempotent, RLS-scoped, hash-chain-audited rows
 *      into the tenant's domain tables (`licences` / `sites`). Re-committing
 *      the same extraction is a natural-key no-op (idempotent by design).
 *
 * Honesty / contract reality:
 *   - The `/upload` endpoint only accepts DOCUMENT mimes (pdf / docx / images)
 *     and the OCR schema set covers the TZ mining licence. So the LICENCE step
 *     (PDF) commits real `licences` rows end-to-end. The site (GeoJSON) and
 *     drill-hole (CSV) steps are NOT document mimes, so they cannot ride this
 *     OCR bridge — they keep recording refs only (the orchestrator already
 *     reports `bytesPersisted:false` for them). That tabular path needs a
 *     `sample`-shaped `/ingest` upload, which is a separate follow-up.
 *
 * All responses are zod-parsed (defence in depth). Never throws to the UI:
 * every leg resolves to a typed outcome so the wizard renders a clean state.
 * Per CLAUDE.md: immutable, no console.log, zod on responses, functions
 * < 50 lines, all user copy lives in `i18n/strings`.
 */

import { z } from 'zod';
import { apiRequest, ApiError, LLM_REQUEST_TIMEOUT_MS } from '@/lib/api-client';
import { validateUpload } from '@/documents/types';

const UPLOAD_PATH = '/api/v1/mining/document-intelligence/upload';
const readyPath = (id: string): string =>
  `/api/v1/mining/document-intelligence/documents/${id}/ready`;
const extractionPath = (id: string): string =>
  `/api/v1/mining/document-intelligence/documents/${id}/extraction`;
const COMMIT_PATH = '/api/v1/mining/onboarding/commit';

/** Generous ceiling for a direct-to-storage upload of a 25 MB scan. */
const BINARY_PUT_TIMEOUT_MS = 120_000;
/** How long to wait for the async OCR worker to produce an extraction. */
const EXTRACTION_POLL_ATTEMPTS = 20;
const EXTRACTION_POLL_INTERVAL_MS = 1_500;

/** The recipe `/commit` entity-type — mirror of the gateway zod enum. */
export type CommitEntityType = 'worker' | 'site' | 'licence';

// ---------------------------------------------------------------------------
// Wire schemas (zod — every response is parsed before use)
// ---------------------------------------------------------------------------

const presignedSchema = z.object({
  headers: z.record(z.string()).default({}),
  degraded: z.boolean().default(false),
});

const uploadResponseSchema = z.object({
  documentId: z.string(),
  ingestionStatus: z.string(),
  presignedPut: z.string().optional().default(''),
  presigned: presignedSchema.optional(),
  extraction: z
    .object({ extractionId: z.string() })
    .nullable()
    .default(null),
});

const readyResponseSchema = z.object({
  documentId: z.string(),
  ingestionStatus: z.string(),
});

const extractionResponseSchema = z.object({
  documentId: z.string(),
  extraction: z.object({ id: z.string() }).nullable().default(null),
});

const commitResponseSchema = z.object({
  session_id: z.string(),
  entity_type: z.string(),
  rows_inserted: z.number().int().nonnegative().default(0),
  rows_updated: z.number().int().nonnegative().default(0),
  rows_skipped: z.number().int().nonnegative().default(0),
});

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** A locale-pure reason key the wizard resolves via its i18n table. */
export type IngestReasonKey =
  | 'reasonMimeNotAllowed'
  | 'reasonTooLarge'
  | 'reasonStorageUnavailable'
  | 'reasonStoragePutFailed'
  | 'reasonReadyFailed'
  | 'reasonUnknown';

/** The result of pushing ONE file's bytes through upload → OCR. */
export type IngestedFile =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly documentId: string;
      /** Present once the async OCR worker produced an extraction row. */
      readonly ocrExtractionId: string | null;
    }
  | {
      readonly ok: false;
      readonly fileName: string;
      readonly reasonKey: IngestReasonKey;
      readonly detail?: string;
    };

/** The committed-rows tally for the confirmation surface. */
export interface CommitTally {
  readonly entityType: CommitEntityType;
  readonly rowsInserted: number;
  readonly rowsUpdated: number;
  readonly rowsSkipped: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reasonKeyForCode(code: string): IngestReasonKey {
  if (code === 'MIME_NOT_ALLOWED') return 'reasonMimeNotAllowed';
  if (code === 'FILE_TOO_LARGE') return 'reasonTooLarge';
  return 'reasonUnknown';
}

/**
 * POST the raw File to a Supabase Storage SIGNED-UPLOAD URL. Mirrors the
 * blessed `doc-upload.ts` wire contract: multipart POST, token in the query
 * string (so NO bearer), `x-upsert`. Resolves true on a 2xx; never throws.
 */
function putBinaryToSignedUrl(args: {
  readonly url: string;
  readonly file: File;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', args.file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', args.url, true);
    xhr.timeout = BINARY_PUT_TIMEOUT_MS;
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(form);
  });
}

async function markReady(documentId: string): Promise<boolean> {
  try {
    const raw = await apiRequest<unknown>(readyPath(documentId), {
      method: 'POST',
    });
    return readyResponseSchema.safeParse(raw).success;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll the document's extraction endpoint until the async OCR worker has
 * written an `ocr_extractions` row, returning its id (the `ocr_extraction_id`
 * the recipe `/commit` consumes). Returns null when it never appears in the
 * window — the caller surfaces a graceful "still processing" note.
 */
async function pollExtractionId(documentId: string): Promise<string | null> {
  for (let attempt = 0; attempt < EXTRACTION_POLL_ATTEMPTS; attempt += 1) {
    try {
      const raw = await apiRequest<unknown>(extractionPath(documentId));
      const parsed = extractionResponseSchema.safeParse(raw);
      if (parsed.success && parsed.data.extraction) {
        return parsed.data.extraction.id;
      }
    } catch {
      // transient — retry within the window
    }
    await sleep(EXTRACTION_POLL_INTERVAL_MS);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push ONE picked file through the real upload → OCR loop and capture its
 * `ocr_extraction_id`. Client-side validates type + size first (CSRF + bearer
 * are threaded by the shared `apiRequest` client). Never throws.
 */
export async function ingestOnboardingFile(file: File): Promise<IngestedFile> {
  const validation = validateUpload({
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });
  if (!validation.ok) {
    return { ok: false, fileName: file.name, reasonKey: reasonKeyForCode(validation.code) };
  }

  try {
    const raw = await apiRequest<unknown>(UPLOAD_PATH, {
      method: 'POST',
      body: { fileName: file.name, mimeType: file.type, fileSize: file.size },
    });
    const parsed = uploadResponseSchema.parse(raw);

    if (parsed.presigned?.degraded || parsed.presignedPut.length === 0) {
      return { ok: false, fileName: file.name, reasonKey: 'reasonStorageUnavailable' };
    }
    const put = await putBinaryToSignedUrl({ url: parsed.presignedPut, file });
    if (!put) {
      return { ok: false, fileName: file.name, reasonKey: 'reasonStoragePutFailed' };
    }
    const ready = await markReady(parsed.documentId);
    if (!ready) {
      return { ok: false, fileName: file.name, reasonKey: 'reasonReadyFailed' };
    }

    const ocrExtractionId =
      parsed.extraction?.extractionId ?? (await pollExtractionId(parsed.documentId));
    return {
      ok: true,
      fileName: file.name,
      documentId: parsed.documentId,
      ocrExtractionId,
    };
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

/** Upload several files sequentially (predictable gateway + storage load). */
export async function ingestOnboardingFiles(
  files: ReadonlyArray<File>,
): Promise<ReadonlyArray<IngestedFile>> {
  const out: IngestedFile[] = [];
  for (const file of files) {
    out.push(await ingestOnboardingFile(file));
  }
  return out;
}

/**
 * Commit ONE captured `ocr_extraction_id` into real domain rows via the
 * recipe pipeline. Idempotent server-side (natural key). Returns the tally,
 * or null when the commit failed (the caller degrades gracefully).
 */
export async function commitOnboardingExtraction(args: {
  readonly ocrExtractionId: string;
  readonly entityType: CommitEntityType;
}): Promise<CommitTally | null> {
  try {
    const raw = await apiRequest<unknown>(COMMIT_PATH, {
      method: 'POST',
      body: { ocr_extraction_id: args.ocrExtractionId, entity_type: args.entityType },
      timeoutMs: LLM_REQUEST_TIMEOUT_MS,
    });
    const parsed = commitResponseSchema.parse(raw);
    return {
      entityType: args.entityType,
      rowsInserted: parsed.rows_inserted,
      rowsUpdated: parsed.rows_updated,
      rowsSkipped: parsed.rows_skipped,
    };
  } catch {
    return null;
  }
}

/**
 * Commit every captured extraction for an entity type and fold the tallies
 * into a single running total. Skips files whose OCR never produced an id.
 */
export async function commitOnboardingEntities(args: {
  readonly extractionIds: ReadonlyArray<string>;
  readonly entityType: CommitEntityType;
}): Promise<CommitTally> {
  const seed: CommitTally = {
    entityType: args.entityType,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
  };
  let tally = seed;
  for (const id of args.extractionIds) {
    const result = await commitOnboardingExtraction({ ocrExtractionId: id, entityType: args.entityType });
    if (result) {
      tally = {
        entityType: args.entityType,
        rowsInserted: tally.rowsInserted + result.rowsInserted,
        rowsUpdated: tally.rowsUpdated + result.rowsUpdated,
        rowsSkipped: tally.rowsSkipped + result.rowsSkipped,
      };
    }
  }
  return tally;
}
