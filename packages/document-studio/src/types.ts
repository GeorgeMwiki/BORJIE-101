/**
 * @borjie/document-studio — public types.
 *
 * Goal-to-document pipeline for property management deliverables:
 *
 *   user goal → intent parse → structure learn → confirm →
 *   multi-LLM synthesis → render → cite/verify → sign & deliver
 *
 * This module ships pure contracts only. Renderers live in
 * `./renderers/`, jurisdictional templates in `./templates/`. The
 * runtime entry point is `studio.generate(req)` in `./studio.ts`.
 *
 * Research basis:
 *   .audit/litfin-sota-2026-05-23/19-document-generation.md
 *
 * Vendor references:
 *   - Carbone.io               https://carbone.io/api-reference.html
 *   - Typst                    https://typst.app/docs/
 *   - Anthropic Skills (docx)  https://github.com/anthropics/skills/tree/main/skills/docx
 *   - Anthropic Skills (pdf)   https://github.com/anthropics/skills/tree/main/skills/pdf
 *   - Anthropic Skills (pptx)  https://github.com/anthropics/skills/tree/main/skills/pptx
 *   - Anthropic Skills (xlsx)  https://github.com/anthropics/skills/tree/main/skills/xlsx
 *   - Anthropic Citations API  https://claude.com/blog/introducing-citations-api
 *   - Dropbox Sign API         https://sign.dropbox.com/products/dropbox-sign-api
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Doc types — extend here when adding a new generator.
// ─────────────────────────────────────────────────────────────────────

export const DOC_TYPES = [
  'monthly_owner_report',
  'eviction_notice',
  'lease_agreement',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_FORMATS = ['docx', 'pdf', 'pptx', 'xlsx', 'html'] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

// ─────────────────────────────────────────────────────────────────────
// Jurisdictions — aligned with constitution + authz-policy.
// ─────────────────────────────────────────────────────────────────────

export const JURISDICTIONS = ['TZ', 'KE', 'UG', 'NG'] as const;
export type JurisdictionId = (typeof JURISDICTIONS)[number];

export function isJurisdictionId(value: unknown): value is JurisdictionId {
  return typeof value === 'string' && (JURISDICTIONS as ReadonlyArray<string>).includes(value);
}

// ─────────────────────────────────────────────────────────────────────
// Citation — span-level grounding compatible with Anthropic Citations.
//
// Every numeric figure, monetary amount, date, percentage, and legal
// reference in a generated document must have a matching Citation in
// the result. The verifier in `citations/citation-verifier.ts` walks
// the rendered text and fails generation if any uncited claim slips
// through.
// ─────────────────────────────────────────────────────────────────────

export const CitationSchema = z.object({
  /** Stable id the verifier matches against in-text markers like `[#cite-001]`. */
  id: z.string().min(1),
  /** What this citation supports — e.g. "$487.00", "30 days", "KE Land Act s.152". */
  claim: z.string().min(1),
  /** Source descriptor — db row, file, statute, message, ledger entry. */
  source: z.object({
    kind: z.enum([
      'ledger_entry',
      'lease',
      'invoice',
      'message',
      'photo',
      'statute',
      'tenant_record',
      'computation',
    ]),
    ref: z.string().min(1),
    url: z.string().url().optional(),
  }),
  /**
   * Optional offset markers into the rendered narrative. The verifier
   * uses these when present and falls back to claim-text matching
   * otherwise.
   */
  span: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

// ─────────────────────────────────────────────────────────────────────
// Request / result shapes — discriminated by doc type.
// ─────────────────────────────────────────────────────────────────────

export interface DocRequest<TData = Record<string, unknown>> {
  readonly type: DocType;
  readonly jurisdiction: JurisdictionId;
  readonly tenantId: string;
  readonly correlationId?: string;
  /**
   * Structured data the doc-type's data-schema validates. Each builder
   * narrows the shape via its own Zod schema.
   */
  readonly data: TData;
  /** Output formats requested; renderers fan out as needed. */
  readonly formats?: ReadonlyArray<DocFormat>;
  /**
   * Optional caller-supplied citations. The narrative synthesizer may
   * add more; the verifier checks the final union covers all claims.
   */
  readonly citations?: ReadonlyArray<Citation>;
}

export interface RenderedArtifact {
  readonly format: DocFormat;
  readonly mimeType: string;
  readonly buffer: Uint8Array;
  /** Stable content hash (sha256 hex) for audit/dedup. */
  readonly sha256: string;
}

export interface DocResult {
  readonly type: DocType;
  readonly jurisdiction: JurisdictionId;
  readonly tenantId: string;
  readonly artifacts: ReadonlyArray<RenderedArtifact>;
  readonly citations: ReadonlyArray<Citation>;
  readonly narrative?: string;
  readonly auditEntryId: string;
  readonly generatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────
// Renderer contract — each external backend (Carbone, Typst, Puppeteer)
// implements this. Stubs return deterministic placeholder buffers so
// the test suite runs without external binaries.
// ─────────────────────────────────────────────────────────────────────

export interface RendererInput<TData = Record<string, unknown>> {
  readonly templateRef: string;
  readonly format: DocFormat;
  readonly data: TData;
}

/**
 * Structured upstream-error payload. Renderers never throw on
 * non-200 / spawn-failure / missing-binary; they return this shape so
 * the synthesis pipeline can react (retry, fall back to stub, surface
 * to the property manager) without try/catch noise.
 */
export interface RendererError {
  /** Stable, machine-readable code — used by callers for branching. */
  readonly code:
    | 'upstream_http_error'
    | 'upstream_timeout'
    | 'upstream_network_error'
    | 'binary_not_found'
    | 'binary_failed'
    | 'browser_not_available'
    | 'invalid_input'
    | 'unsupported_format';
  /** Human-readable message — safe to log; never leaks secrets. */
  readonly message: string;
  /** Upstream HTTP status code when relevant. */
  readonly status?: number;
  /** Origin of the error (e.g. `carbone`, `typst`, `puppeteer`). */
  readonly origin: string;
}

export interface RendererOutput {
  readonly buffer: Uint8Array;
  readonly mimeType: string;
  /** Set when the upstream rendering pipeline failed; buffer is empty. */
  readonly error?: RendererError;
}

export interface Renderer {
  readonly id: string;
  render<TData>(input: RendererInput<TData>): Promise<RendererOutput>;
}

// ─────────────────────────────────────────────────────────────────────
// MIME type map — central source of truth.
// ─────────────────────────────────────────────────────────────────────

export const MIME_TYPES: Readonly<Record<DocFormat, string>> = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: 'text/html; charset=utf-8',
});
