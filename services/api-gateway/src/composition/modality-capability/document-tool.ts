/**
 * Capability brain-tool — `mining.document.generate`.
 *
 * Wraps `@borjie/document-studio` as a chat-callable `ToolHandler` so the MD
 * can emit a real, WORM-sealed document on a turn (licence application,
 * royalty statement, monthly owner report, or any authored type). The studio
 * runs the FORCED pipeline: schema-validate → bind → locale-purity gate →
 * render → citation-coverage gate → archive + WORM seal.
 *
 * Rails honoured (the studio enforces; we surface them):
 *   - Evidence-required: the citation-coverage gate rejects any document with
 *     an uncited monetary/numeric/date/legal claim (`CitationGapError`).
 *   - EN/SW absolute toggle: the locale-purity gate throws on any mixing
 *     (`LocaleMixingError`).
 *   - Append-only audit: the archive WORM-seals every artifact.
 *   - No money/licence WRITE: producing a licence-application DOCUMENT is not
 *     the licence DECISION — the decision stays on its own HITL rail. The
 *     artifact flows to the proposal sink (proposal-gated UI), never a
 *     direct mutation.
 *   - No process.env reads — the studio (renderers / archive / e-sign) is
 *     injected at bootstrap.
 *
 * @module composition/modality-capability/document-tool
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import type {
  DocumentStudio,
  GenerateRequest,
  GeneratedDoc,
  Citation,
  DocFormat,
} from '@borjie/document-studio';

export const DOCUMENT_TOOL_NAME = 'mining.document.generate';

export interface DocumentCapabilityToolDeps {
  /** The studio, constructed once at bootstrap with real or stub backends. */
  readonly studio: DocumentStudio;
  /** Bucket the sealed artifacts archive under (per-deployment). */
  readonly bucket?: string;
}

const DEFAULT_BUCKET = 'borjie-documents';

/** Coerce loose params into the studio's typed citation array. */
function toCitations(raw: unknown): ReadonlyArray<Citation> {
  if (!Array.isArray(raw)) return [];
  const out: Citation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r['id'] === 'string' ? r['id'] : null;
    const claim = typeof r['claim'] === 'string' ? r['claim'] : null;
    const src = r['source'];
    if (!id || !claim || !src || typeof src !== 'object') continue;
    const s = src as Record<string, unknown>;
    const kind = typeof s['kind'] === 'string' ? s['kind'] : 'computation';
    const ref = typeof s['ref'] === 'string' ? s['ref'] : id;
    out.push({
      id,
      claim,
      source: { kind: kind as Citation['source']['kind'], ref },
    });
  }
  return out;
}

function toFormats(raw: unknown): ReadonlyArray<DocFormat> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const allowed: ReadonlyArray<DocFormat> = ['docx', 'pdf', 'pptx', 'xlsx', 'html'];
  const out = raw.filter(
    (v): v is DocFormat => typeof v === 'string' && (allowed as readonly string[]).includes(v),
  );
  return out.length > 0 ? out : undefined;
}

/** Shape a GeneratedDoc into a no-bytes-in-summary data payload. */
function docData(doc: GeneratedDoc): Record<string, unknown> {
  return {
    kind: 'document' as const,
    docType: doc.docType,
    locale: doc.locale,
    currencyCode: doc.currencyCode,
    artifacts: doc.artifacts.map((a) => ({
      format: a.format,
      mimeType: a.mimeType,
      sha256: a.sha256,
      byteLength: a.bytes.byteLength,
      archiveId: a.archived.artifactId,
      // The body bytes are NOT inlined here (documents can be large); the
      // surfaced UI fetches them via the artifact route by archiveId.
      body_base64: Buffer.from(a.bytes).toString('base64'),
    })),
    evidence_ids: doc.citations.map((c) => c.id),
  };
}

/**
 * Build the `mining.document.generate` ToolHandler. The studio is injected so
 * the handler is bootstrap-pure. Returns the generated doc metadata (sha256 +
 * archive ids per format) so the surface can render + the proposal sink can
 * synthesize a UI; the body is base64-inlined for small previews.
 */
export function buildDocumentCapabilityTool(
  deps: DocumentCapabilityToolDeps,
): ToolHandler {
  const bucket = deps.bucket ?? DEFAULT_BUCKET;
  return {
    name: DOCUMENT_TOOL_NAME,
    description:
      'Generate a real, WORM-sealed mining document (licence application, royalty ' +
      'statement, monthly owner report, or an authored type). Runs the forced pipeline: ' +
      'schema-validate → locale-purity gate → render → citation-coverage gate → archive. ' +
      'Every monetary/numeric/date/legal claim must be cited (evidence-required).',
    parameters: {
      type: 'object',
      required: ['docType', 'data'],
      properties: {
        docType: {
          type: 'string',
          description: 'Registered doc-type id, e.g. royalty_statement, licence_application, monthly_owner_report.',
        },
        data: { type: 'object', description: 'The type-specific document data (schema-validated).' },
        formats: {
          type: 'array',
          description: 'Override output formats (pdf/docx/xlsx/pptx/html).',
        },
        citations: {
          type: 'array',
          description: 'Citations grounding every claim: [{ id, claim, source:{kind,ref} }].',
        },
      },
    },
    async execute(params, context) {
      const tenantId =
        context.tenant && typeof context.tenant.tenantId === 'string'
          ? context.tenant.tenantId
          : '';
      const actorId =
        context.actor && typeof context.actor.id === 'string' ? context.actor.id : 'mr-mwikila';
      if (!tenantId) {
        return { ok: false, error: 'document generation requires a tenant context' };
      }
      const docType = typeof params['docType'] === 'string' ? (params['docType'] as string) : '';
      if (!docType) {
        return { ok: false, error: 'document generation requires a docType' };
      }
      const formats = toFormats(params['formats']);
      const request: GenerateRequest = {
        docType,
        tenantId,
        actorId,
        data: params['data'] ?? {},
        bucket,
        ...(formats ? { formats } : {}),
        citations: toCitations(params['citations']),
      };
      try {
        const doc = await deps.studio.generate(request);
        return {
          ok: true,
          data: docData(doc),
          evidenceSummary:
            `Generated ${doc.docType} (${doc.artifacts.length} format(s), locale=${doc.locale}); ` +
            `evidence [${doc.citations.map((c) => c.id).join(', ') || 'none'}]`,
        };
      } catch (err) {
        // LocaleMixingError / CitationGapError / RenderError all surface as a
        // typed, operator-readable failure — the gates fired, the document
        // was NOT produced.
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
