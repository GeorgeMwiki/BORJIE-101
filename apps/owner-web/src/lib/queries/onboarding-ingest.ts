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
 *     (PDF) commits real `licences` rows end-to-end via the OCR bridge.
 *   - The site (GeoJSON) and drill-hole (CSV) steps are NOT document mimes, so
 *     they cannot ride the OCR bridge. They take the SEPARATE `sample`-shaped
 *     `/ingest` + `/commit` path: the bytes are parsed CLIENT-SIDE into a
 *     `TabularSample` (GeoJSON features → site rows; CSV rows → drill rows) and
 *     POSTed as `{ sample }`. The gateway commit creates real `sites` /
 *     `drill_holes` rows (RLS-scoped, hash-chain audited, idempotent by natural
 *     key). See {@link geoJsonToSites} / {@link csvToDrillHoles} /
 *     {@link commitOnboardingSample}.
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
export type CommitEntityType = 'worker' | 'site' | 'licence' | 'drill_hole';

/** The recipe `/ingest`+`/commit` `sample` path (NON-document tabular feeds). */
const INGEST_PATH = '/api/v1/mining/onboarding/ingest';

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

// ---------------------------------------------------------------------------
// STRETCH — tabular `sample` path (GeoJSON sites + CSV drill holes)
//
// These feeds are NOT document mimes, so they cannot ride the OCR bridge. We
// parse the bytes CLIENT-SIDE into the gateway's `TabularSample` shape and
// POST `{ sample }` to /ingest (proposal) + /commit (real rows). The gateway
// owns RLS + audit-chain + idempotency; here we only shape the sample.
// ---------------------------------------------------------------------------

/** The gateway `TabularSample` wire shape (mirror of its zod schema). */
export interface TabularSample {
  readonly source_file: { readonly id: string; readonly name: string };
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly total_row_count: number;
}

const geoJsonFeatureSchema = z.object({
  type: z.literal('Feature').optional(),
  properties: z.record(z.unknown()).nullable().default({}),
});

const geoJsonSchema = z.object({
  type: z.string().optional(),
  features: z.array(geoJsonFeatureSchema).default([]),
});

/** Coerce any property scalar to a stable cell string. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Parse a GeoJSON FeatureCollection into a site `TabularSample`: each feature's
 * `properties` become a row keyed by the union of all property names. Returns
 * null when the text is not parseable GeoJSON with features.
 */
export function geoJsonToSites(fileName: string, text: string): TabularSample | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = geoJsonSchema.safeParse(json);
  if (!parsed.success || parsed.data.features.length === 0) return null;

  const propsList = parsed.data.features.map((f) => f.properties ?? {});
  const headers = Array.from(
    propsList.reduce<Set<string>>((acc, props) => {
      Object.keys(props).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  const safeHeaders = headers.length > 0 ? headers : ['name'];
  const rows = propsList.map((props) => safeHeaders.map((h) => cell(props[h])));
  return {
    source_file: { id: fileName, name: fileName },
    headers: safeHeaders,
    rows,
    total_row_count: rows.length,
  };
}

/** Split one CSV line honouring simple double-quoted fields (no embedded \n). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Parse a CSV (header row + data rows) into a drill-hole `TabularSample`.
 * Returns null when there is no header + at least one data row.
 */
export function csvToDrillHoles(fileName: string, text: string): TabularSample | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const headers = splitCsvLine(lines[0]!);
  if (headers.length === 0) return null;
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return headers.map((_, i) => cells[i] ?? '');
  });
  return {
    source_file: { id: fileName, name: fileName },
    headers,
    rows,
    total_row_count: rows.length,
  };
}

/**
 * Commit ONE parsed `TabularSample` into real domain rows via the recipe
 * `/commit` `sample` path. Idempotent server-side (natural key). Returns the
 * tally, or null when the commit failed (the caller degrades gracefully).
 */
export async function commitOnboardingSample(args: {
  readonly sample: TabularSample;
  readonly entityType: CommitEntityType;
}): Promise<CommitTally | null> {
  try {
    const raw = await apiRequest<unknown>(COMMIT_PATH, {
      method: 'POST',
      body: { sample: args.sample, entity_type: args.entityType },
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

/** Touch the `/ingest` path constant so it is wired (proposal preview hook). */
export const ONBOARDING_INGEST_PATH = INGEST_PATH;
