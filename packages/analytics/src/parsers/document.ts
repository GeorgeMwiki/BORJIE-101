/**
 * Pluggable document parsers — Unstructured.io + LlamaParse adapters.
 *
 * SOTA 2026 PDF/scan → tidy data extractors are remote services. We
 * keep them as `DocumentParser` adapters; callers configure an API key
 * + base URL and we POST the document bytes. Without a key, the
 * adapter fails fast at construction time so the caller picks another
 * path (manual CSV upload, OCR, etc.).
 *
 * Why ports, not bundled clients: rotating providers (Reducto, GROBID,
 * MinerU, EasyOCR) is a 1-line composition root change rather than a
 * package rewrite. Cost optimisation in 2026 is largely about picking
 * the right parser per document class.
 */

import type { DocumentParser, ParsedRow } from '../types.js';

export interface UnstructuredAdapterConfig {
  readonly apiKey: string;
  /** Defaults to the public Unstructured.io endpoint. Override for self-hosted. */
  readonly baseUrl?: string;
  /** Optional `fetch` override for testing or proxying. */
  readonly fetchFn?: typeof fetch;
  /** Strategy hint: 'fast' (default) or 'hi_res'. */
  readonly strategy?: 'fast' | 'hi_res';
}

export function createUnstructuredParser(config: UnstructuredAdapterConfig): DocumentParser {
  if (!config.apiKey) {
    throw new Error('[analytics/parsers/document] Unstructured.io adapter requires apiKey');
  }
  const baseUrl = config.baseUrl ?? 'https://api.unstructuredapp.io';
  const f = config.fetchFn ?? fetch;
  const strategy = config.strategy ?? 'fast';
  return {
    id: 'unstructured',
    async parse(bytes, mime) {
      const form = new FormData();
      form.append('files', new Blob([bytes as unknown as ArrayBuffer], { type: mime }), 'doc');
      form.append('strategy', strategy);
      form.append('output_format', 'application/json');
      const res = await f(`${baseUrl}/general/v0/general`, {
        method: 'POST',
        headers: { 'unstructured-api-key': config.apiKey },
        body: form,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(
          `[analytics/parsers/document] Unstructured.io error ${res.status}: ${txt.slice(0, 200)}`,
        );
      }
      const json = (await res.json()) as unknown;
      return normaliseUnstructured(json);
    },
  };
}

function normaliseUnstructured(json: unknown): readonly ParsedRow[] {
  // Unstructured returns an array of "elements". Each element has a
  // `type`, `text`, and a `metadata` object. For tabular data we want
  // elements where `type === 'Table'` and the table is provided as HTML;
  // we surface a single row per non-table element so the caller can
  // schema-infer. Table HTML parsing is left to the renderer for now.
  if (!Array.isArray(json)) return [];
  const rows: ParsedRow[] = [];
  for (const el of json) {
    if (el && typeof el === 'object') {
      const e = el as Record<string, unknown>;
      rows.push(
        Object.freeze({
          type: String(e['type'] ?? ''),
          text: String(e['text'] ?? ''),
          page: (e['metadata'] as Record<string, unknown> | undefined)?.['page_number'] ?? null,
        }),
      );
    }
  }
  return rows;
}

// ───────────────────────── LlamaParse ─────────────────────────

export interface LlamaParseAdapterConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  /** Result format. Default 'markdown'. */
  readonly resultType?: 'text' | 'markdown';
}

export function createLlamaParseParser(config: LlamaParseAdapterConfig): DocumentParser {
  if (!config.apiKey) {
    throw new Error('[analytics/parsers/document] LlamaParse adapter requires apiKey');
  }
  const baseUrl = config.baseUrl ?? 'https://api.cloud.llamaindex.ai/api/parsing';
  const f = config.fetchFn ?? fetch;
  const resultType = config.resultType ?? 'markdown';
  return {
    id: 'llamaparse',
    async parse(bytes, mime) {
      const form = new FormData();
      form.append('file', new Blob([bytes as unknown as ArrayBuffer], { type: mime }), 'doc');
      const upload = await f(`${baseUrl}/upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
      });
      if (!upload.ok) {
        throw new Error(
          `[analytics/parsers/document] LlamaParse upload error ${upload.status}`,
        );
      }
      const uploadJson = (await upload.json()) as { id?: string };
      const jobId = uploadJson.id;
      if (!jobId) {
        throw new Error('[analytics/parsers/document] LlamaParse upload returned no job id');
      }
      // Single-shot result poll. Caller is responsible for retries on
      // 202 (the SOTA pattern uses webhooks for production workloads).
      const result = await f(`${baseUrl}/job/${jobId}/result/${resultType}`, {
        headers: { authorization: `Bearer ${config.apiKey}` },
      });
      if (!result.ok) {
        throw new Error(
          `[analytics/parsers/document] LlamaParse result error ${result.status}`,
        );
      }
      const json = (await result.json()) as { [k: string]: unknown };
      const text = String(json[resultType] ?? '');
      // We return ONE row per parser call — the renderer / schema
      // inference can decide whether to split sections, headings, etc.
      return [Object.freeze({ type: 'document', text })];
    },
  };
}

/**
 * Pluggable parser registry — name → adapter factory. Composition root
 * picks the right adapter based on tenant config + document MIME.
 */
export interface DocumentParserRegistry {
  resolve(parserId: string): DocumentParser | null;
}

export function createParserRegistry(parsers: readonly DocumentParser[]): DocumentParserRegistry {
  const map = new Map(parsers.map((p) => [p.id, p]));
  return {
    resolve(id) {
      return map.get(id) ?? null;
    },
  };
}
