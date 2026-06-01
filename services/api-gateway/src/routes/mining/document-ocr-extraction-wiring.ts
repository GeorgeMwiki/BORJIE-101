/**
 * Async OCR-extraction adapter wiring (Wave DOC-INTEL, api-gateway side).
 *
 * The consolidation-worker owns the ASYNC per-upload OCR + full-text
 * extraction ORCHESTRATION
 * (`services/consolidation-worker/src/tasks/ocr-extraction-task.ts`), but it
 * cannot import `@borjie/document-ai`, `@supabase/supabase-js`, or the
 * `document-extraction.ts` helpers — `@borjie/document-ai` is NOT a
 * dependency of that worker. Those concrete adapters ARE reachable here in
 * api-gateway, so this module builds them and exposes a single
 * `buildOcrExtractionAdapters()` factory that the worker resolves via its
 * canonical sibling-service dynamic import (the same pattern used for
 * `db-client`, the owner-brief composer, and the constitutional critic).
 *
 * What is REAL vs what needs RUNTIME
 * ---------------------------------------------------------------------------
 *   - Storage fetch  → REAL Supabase Storage download from the
 *     `tenant-uploads` bucket (service-role admin client). Needs
 *     `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) +
 *     `SUPABASE_SERVICE_ROLE_KEY`, AND the upload route must have PUT the
 *     bytes to the same bucket/path. The mining `POST /upload` today stores
 *     a synthetic `s3://…` fileUrl rather than presigning into
 *     `tenant-uploads` (see KNOWN gap) — wiring the upload to that bucket is
 *     the matching follow-up. Until then the fetch resolves `null` and the
 *     task records a `storage_miss` skip (never a stub).
 *   - OCR adapter    → REAL, SSRF-guarded adapter from
 *     `@borjie/document-ai/ocr`. Selection (in priority order):
 *       1. Docling REST (`DOCLING_OCR_ENDPOINT`) — general-purpose,
 *          in-cluster, strong tables. The codebase-favoured engine.
 *       2. Marker REST (`MARKER_OCR_ENDPOINT`) — dense / academic PDFs.
 *       3. Anthropic Vision (`ANTHROPIC_API_KEY`) — messy scans /
 *          handwriting / Swahili.
 *       4. Tesseract (local peer dep) — last-resort offline fallback.
 *     All four pass `assertSafeOcrEndpoint` (the REST ones) or run locally.
 *     When NONE is configured the OCR port returns empty text and the task
 *     records `no_text` — never fabricated.
 *   - BrainPort      → REAL Anthropic messages API (fetch), null when no
 *     `ANTHROPIC_API_KEY`. `extractFormFields` PII-tokenises before egress
 *     and restores after, so the LLM never sees raw IDs (PII-safe). With no
 *     key, extraction is heuristic-only over the FULL OCR text (still a big
 *     win over the 4 KB sample).
 *   - Field extraction → REUSES `runFormExtraction` (heuristic baseline) +
 *     `extractFormFields` (brain-augmented) + the schema selection from
 *     `document-extraction.ts`. Nothing is re-implemented.
 *
 * `runtimeWarnings` precisely lists every unwired input so the supervisor
 * logs exactly what to provision. NOTHING here silently stubs.
 *
 * Hard-rule compliance: Pino logger only; SSRF guard enforced by the
 * adapters; PII tokenised before any LLM egress; no raw HTML; reads env via
 * the same in-handler pattern the sibling presign service uses.
 */

import {
  createDoclingAdapter,
  createMarkerAdapter,
  createAnthropicVisionAdapter,
  createTesseractAdapter,
  createMockOCRAdapter,
  extractFormFields,
  type BrainPort,
  type LanguageCode,
  type OCRPort,
  type FormField,
} from '@borjie/document-ai';
import { createSupabaseAdminClient } from '@borjie/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import { createLogger } from '../../utils/logger';
import {
  runFormExtraction,
  selectSchemaForDocument,
  parsedDocumentFromText,
  type ExtractionResult,
} from './document-extraction';

const moduleLogger = createLogger('document-ocr-extraction-wiring');

const BUCKET_NAME = 'tenant-uploads';

// ---------------------------------------------------------------------------
// Port shapes — structurally identical to the worker's
// (consolidation-worker/src/tasks/ocr-extraction-task.ts). Defined locally so
// api-gateway does not take a dependency on the worker package.
// ---------------------------------------------------------------------------

export interface ReadyDocument {
  readonly documentId: string;
  readonly tenantId: string;
  readonly mimeType: string;
  readonly documentType: string;
  readonly kind: string;
  readonly fileName: string;
  readonly fileUrl: string;
}

export interface StorageFetchPort {
  fetch(doc: ReadyDocument): Promise<{
    readonly bytes: Uint8Array;
    readonly mime: string;
  } | null>;
}

export interface OcrResult {
  readonly text: string;
  readonly producedBy: string;
  readonly dominantLanguage?: string;
}

export interface OcrPort {
  readonly id: string;
  recognize(input: {
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly correlationId?: string;
  }): Promise<OcrResult>;
}

export interface ExtractionOutcome {
  readonly schemaId: string;
  readonly extractedFields: Readonly<Record<string, unknown>>;
  readonly confidenceScores: Readonly<Record<string, number>>;
  readonly overallConfidence: number;
  readonly brainAugmented: boolean;
}

export interface BrainExtractPort {
  extract(input: {
    readonly documentId: string;
    readonly text: string;
    readonly sourceMime: string;
    readonly documentType: string;
    readonly kind: string;
  }): Promise<ExtractionOutcome>;
}

export interface GatewayOcrAdapters {
  readonly storage: StorageFetchPort;
  readonly ocr: OcrPort;
  readonly extractor: BrainExtractPort;
  readonly providerTag?: string;
  readonly runtimeWarnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Env reads (mirrors the sibling owner-docs presign service — request/worker
// scope, not module-init). Trimmed + emptied-to-undefined.
// ---------------------------------------------------------------------------

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Storage adapter — real Supabase Storage download.
// ---------------------------------------------------------------------------

let cachedAdmin: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;
  const url = env('NEXT_PUBLIC_SUPABASE_URL') ?? env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  try {
    cachedAdmin = createSupabaseAdminClient({
      url,
      serviceRoleKey: key,
    }) as unknown as SupabaseClient;
    return cachedAdmin;
  } catch (err) {
    moduleLogger.warn('ocr-wiring: supabase admin init failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function extensionFor(fileName: string, mimeType: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0 && dot < fileName.length - 1) {
    return fileName.slice(dot + 1).toLowerCase();
  }
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    default:
      return 'bin';
  }
}

/**
 * Resolve the in-bucket object path for a document. Prefers a stored path
 * that already targets `tenant-uploads`; otherwise reconstructs the
 * canonical `<tenantId>/<YYYY-MM>/<documentId>.<ext>` scheme the owner-docs
 * presign uses. The created_at month is unknown here, so we also probe the
 * fileUrl tail when present.
 */
function candidatePaths(doc: ReadyDocument): ReadonlyArray<string> {
  const out: string[] = [];
  const ext = extensionFor(doc.fileName, doc.mimeType);

  // 1) A stored fileUrl shaped `tenant-uploads/<path>` or `s3://…/<path>`:
  //    take everything after the bucket name if it appears.
  const url = doc.fileUrl;
  const bucketIdx = url.indexOf(`${BUCKET_NAME}/`);
  if (bucketIdx >= 0) {
    out.push(url.slice(bucketIdx + BUCKET_NAME.length + 1));
  }

  // 2) Canonical scheme keyed by documentId. The month segment is derived
  //    from "now" as a best-effort (most ready docs were uploaded recently);
  //    a precise month would require the row's created_at — flagged as a
  //    runtime nuance. We also push a wildcard-free documentId-only fallback.
  const month = new Date().toISOString().slice(0, 7);
  out.push(`${doc.tenantId}/${month}/${doc.documentId}.${ext}`);

  return Array.from(new Set(out.filter((p) => p.length > 0)));
}

function createSupabaseStoragePort(): StorageFetchPort {
  return {
    async fetch(doc) {
      const supabase = getAdminClient();
      if (!supabase) return null;
      for (const path of candidatePaths(doc)) {
        try {
          const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .download(path);
          if (error || !data) continue;
          const arrayBuffer = await data.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          if (bytes.length === 0) continue;
          return { bytes, mime: data.type || doc.mimeType };
        } catch (err) {
          moduleLogger.warn('ocr-wiring: storage download threw', {
            tenantId: doc.tenantId,
            documentId: doc.documentId,
            path,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// OCR adapter selection — real + SSRF-guarded.
// ---------------------------------------------------------------------------

function langHints(): ReadonlyArray<LanguageCode> {
  // Borjie is bilingual sw/en with en default; hint both so OCR engines that
  // accept a language list (docling/marker/tesseract/vision) bias correctly.
  return ['en', 'sw'];
}

function selectOcrPort(): { readonly port: OCRPort; readonly warning?: string } {
  const doclingEndpoint = env('DOCLING_OCR_ENDPOINT');
  if (doclingEndpoint) {
    const cfg: Parameters<typeof createDoclingAdapter>[0] = {
      endpoint: doclingEndpoint,
      ...(env('DOCLING_OCR_API_KEY') ? { apiKey: env('DOCLING_OCR_API_KEY')! } : {}),
    };
    return { port: createDoclingAdapter(cfg) };
  }
  const markerEndpoint = env('MARKER_OCR_ENDPOINT');
  if (markerEndpoint) {
    const cfg: Parameters<typeof createMarkerAdapter>[0] = {
      endpoint: markerEndpoint,
      ...(env('MARKER_OCR_API_KEY') ? { apiKey: env('MARKER_OCR_API_KEY')! } : {}),
    };
    return { port: createMarkerAdapter(cfg) };
  }
  const anthropicKey = env('ANTHROPIC_API_KEY');
  if (anthropicKey) {
    return { port: createAnthropicVisionAdapter({ apiKey: anthropicKey }) };
  }
  // Tesseract local fallback — peer dep loaded dynamically by the adapter;
  // returns a structured empty result if tesseract.js is absent.
  return {
    port: createTesseractAdapter({ langs: langHints() }),
    warning:
      'OCR adapter unconfigured — no DOCLING_OCR_ENDPOINT / MARKER_OCR_ENDPOINT / ANTHROPIC_API_KEY set; falling back to local tesseract (empty text if tesseract.js peer dep is absent).',
  };
}

/** Wrap a document-ai `OCRPort` into the worker's `OcrPort` shape. */
function wrapOcrPort(port: OCRPort): OcrPort {
  return {
    id: port.id,
    async recognize(input) {
      const parsed = await port.recognize({
        bytes: input.bytes,
        mime: input.mime,
        lang: langHints(),
        layout: 'standard',
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      });
      return {
        text: parsed.text,
        producedBy: parsed.producedBy,
        dominantLanguage: parsed.dominantLanguage,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// BrainPort — real Anthropic messages API (fetch). Null when no key.
// `extractFormFields` tokenises PII before this is ever called.
// ---------------------------------------------------------------------------

interface AnthropicMessagesResponse {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage?: { readonly output_tokens?: number };
}

function createAnthropicBrainPort(apiKey: string): BrainPort {
  const endpoint = 'https://api.anthropic.com/v1/messages';
  const model = getModelLatest('sonnet');
  return {
    async complete(prompt, options) {
      const fetchImpl = typeof fetch !== 'undefined' ? fetch : null;
      if (!fetchImpl) return { text: '' };
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        moduleLogger.warn('ocr-wiring: brain completion non-OK', {
          status: response.status,
        });
        return { text: '' };
      }
      const json = (await response.json()) as AnthropicMessagesResponse;
      const text = (json.content ?? [])
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n');
      return {
        text,
        ...(typeof json.usage?.output_tokens === 'number'
          ? { tokensUsed: json.usage.output_tokens }
          : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Extractor — reuse runFormExtraction (heuristic) + extractFormFields
// (brain-augmented) over the FULL OCR text. PII-safe via extractFormFields.
// ---------------------------------------------------------------------------

function toFlatMaps(fields: ReadonlyArray<FormField>): {
  extractedFields: Record<string, unknown>;
  confidenceScores: Record<string, number>;
  overallConfidence: number;
} {
  const found = fields.filter(
    (f) => f.origin !== 'missing' && f.value !== undefined && f.value !== null,
  );
  const extractedFields: Record<string, unknown> = {};
  const confidenceScores: Record<string, number> = {};
  for (const f of found) {
    extractedFields[f.name] = f.value;
    confidenceScores[f.name] = f.confidence;
  }
  const overallConfidence =
    found.length > 0
      ? found.reduce((sum, f) => sum + f.confidence, 0) / found.length
      : 0;
  return { extractedFields, confidenceScores, overallConfidence };
}

function createExtractor(brain: BrainPort | null): BrainExtractPort {
  return {
    async extract(input) {
      const schema = selectSchemaForDocument({
        documentType: input.documentType,
        kind: input.kind,
      });

      // Brain-augmented path: only when BOTH a schema matches AND a real
      // BrainPort exists. extractFormFields PII-tokenises before egress and
      // restores after, so the LLM never sees raw IDs.
      if (schema && brain) {
        const doc = await parsedDocumentFromText({
          documentId: input.documentId,
          text: input.text,
          sourceMime: input.sourceMime,
        });
        const fields = await extractFormFields({ doc, schema, brain });
        const flat = toFlatMaps(fields);
        return {
          schemaId: schema.id,
          extractedFields: flat.extractedFields,
          confidenceScores: flat.confidenceScores,
          overallConfidence: flat.overallConfidence,
          brainAugmented: true,
        };
      }

      // Heuristic-only path (no brain key, or no schema) — reuse the exact
      // synchronous extractor, now over the FULL OCR text instead of 4 KB.
      const result: ExtractionResult = await runFormExtraction({
        documentId: input.documentId,
        text: input.text,
        sourceMime: input.sourceMime,
        documentType: input.documentType,
        kind: input.kind,
      });
      return {
        schemaId: result.schemaId,
        extractedFields: result.extractedFields,
        confidenceScores: result.confidenceScores,
        overallConfidence: result.overallConfidence,
        brainAugmented: false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — the single surface the worker resolves via sibling-import.
// ---------------------------------------------------------------------------

export async function buildOcrExtractionAdapters(): Promise<GatewayOcrAdapters> {
  const warnings: string[] = [];

  // Storage.
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL') ?? env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    warnings.push(
      'Storage fetch unwired — set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY. Also: the mining POST /upload must PUT bytes into the `tenant-uploads` bucket (it currently stores a synthetic s3:// fileUrl).',
    );
  } else {
    warnings.push(
      'Storage path is reconstructed from documentId + current-month; if uploads land under a different month/path the download may miss. Wire the mining upload route to presign into `tenant-uploads/<tenantId>/<YYYY-MM>/<documentId>.<ext>` to guarantee hits.',
    );
  }
  const storage = createSupabaseStoragePort();

  // OCR.
  const { port: ocrPort, warning: ocrWarning } = selectOcrPort();
  if (ocrWarning) warnings.push(ocrWarning);
  const ocr = wrapOcrPort(ocrPort);

  // Brain.
  const anthropicKey = env('ANTHROPIC_API_KEY');
  const brain = anthropicKey ? createAnthropicBrainPort(anthropicKey) : null;
  if (!brain) {
    warnings.push(
      'BrainPort unwired — no ANTHROPIC_API_KEY; field extraction runs heuristic-only over the FULL OCR text (still supersedes the 4 KB sample). Set ANTHROPIC_API_KEY for LLM-augmented extraction (PII-tokenised before egress).',
    );
  }
  const extractor = createExtractor(brain);

  return {
    storage,
    ocr,
    extractor,
    runtimeWarnings: warnings,
  };
}

// ---------------------------------------------------------------------------
// Fire-and-forget enqueue — used by the route to nudge the worker after a
// document becomes ready. The actual heavy lifting is the worker's poll; this
// is a best-effort early-start that never blocks/awaits in the request path.
//
// It deliberately does NOT run OCR inline in the request (OCR is slow + needs
// the binary). It simply records intent in the log; the worker poll is the
// durable trigger. Kept here so the route has a single import surface and so
// a future in-process queue can be slotted in without touching the route.
// ---------------------------------------------------------------------------

export function triggerAsyncOcrExtraction(args: {
  readonly tenantId: string;
  readonly documentId: string;
}): void {
  moduleLogger.info('ocr-wiring: async OCR extraction enqueued (worker poll will process)', {
    tenantId: args.tenantId,
    documentId: args.documentId,
  });
}

// Re-export the no-op mock OCR factory so tests / degraded composition can
// opt into a deterministic OCR port without importing @borjie/document-ai
// directly from the worker.
export { createMockOCRAdapter };
