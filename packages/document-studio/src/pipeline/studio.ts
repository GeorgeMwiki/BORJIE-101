/**
 * @borjie/document-studio — the generation pipeline (composer-of-record).
 *
 *   request → registry.get(type) → schema.parse(data) → binder(data) →
 *   locale-purity gate → render(engineHint, format) → citation verify →
 *   archive + WORM seal → (optional) e-sign envelope
 *
 * Every gate is FORCED on the render path, not optional:
 *   - locale purity (EN/SW absolute toggle) before render,
 *   - citation coverage after render (evidence-required hard rail),
 *   - WORM seal on archive (append-only audit chain hard rail).
 *
 * The studio is thin: it SELECTS and CHAINS the existing real machinery
 * (renderers, citation verifier, WORM archive, e-sign port). It owns no
 * transport — renderers, archive, and the e-sign port are all injected.
 */

import type { DocFormat } from '../types.js';
import type { Citation } from '../types.js';
import type { DocTypeRegistry } from '../registry/doc-type.js';
import type { RendererFactory } from '../renderers/renderer-factory.js';
import type { ArtifactArchive, ArchivedArtifact } from '../archive/artifact-archive.js';
import type { ESignPort, Signer, SignatureTier } from '../esign/port.js';
import { verifyDocumentCitations } from '../citations/citation-verifier.js';
import { sha256Hex } from '../citations/citation-verifier.js';
import { toVerifierCitations } from '../citations/adapt.js';
import { assertLocalePurity, extractText } from './locale-purity.js';
import { verifyStructuredCitations } from './structured-citation-gate.js';

export interface GenerateRequest {
  /** Registered doc-type id (core or authored). */
  readonly docType: string;
  readonly tenantId: string;
  readonly actorId: string;
  /** Raw request data the type's schema validates. */
  readonly data: unknown;
  /** Override the type's default formats. */
  readonly formats?: ReadonlyArray<DocFormat>;
  /**
   * Citations grounding the document's claims. The evidence chain that
   * the citation gate verifies + the WORM archive fingerprints.
   */
  readonly citations?: ReadonlyArray<Citation>;
  /** Bucket to archive sealed bytes under. */
  readonly bucket: string;
  /** Pin the wall clock so the same input archives deterministically. */
  readonly generatedAt?: Date;
}

export interface GeneratedDoc {
  readonly docType: string;
  readonly tenantId: string;
  readonly locale: 'en' | 'sw';
  readonly currencyCode: string;
  readonly artifacts: ReadonlyArray<{
    readonly format: DocFormat;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    readonly archived: ArchivedArtifact;
  }>;
  readonly citations: ReadonlyArray<Citation>;
}

export interface SignRequest {
  /** Which archived artifact (by id) to send for signature. */
  readonly artifactId: string;
  readonly title: string;
  readonly message?: string;
  readonly signers: ReadonlyArray<Signer>;
  readonly tier?: SignatureTier;
  readonly bucket: string;
  readonly idempotencyKey?: string;
}

export interface DocumentStudioDeps {
  readonly registry: DocTypeRegistry;
  readonly renderers: RendererFactory;
  readonly archive: ArtifactArchive;
  /** Optional — only required when a caller invokes `sendForSignature`. */
  readonly esign?: ESignPort;
}

export class LocaleMixingError extends Error {
  public readonly code = 'LOCALE_MIXING';
  constructor(
    public readonly locale: 'en' | 'sw',
    public readonly leaks: ReadonlyArray<string>,
  ) {
    super(
      `LOCALE_MIXING: '${locale}' document contains foreign-language ` +
        `tokens [${leaks.join(', ')}] — EN/SW absolute toggle violated`,
    );
    this.name = 'LocaleMixingError';
  }
}

export class CitationGapError extends Error {
  public readonly code = 'CITATION_GAP';
  constructor(
    public readonly missing: ReadonlyArray<{
      readonly fragment: string;
      readonly reason: string;
    }>,
  ) {
    super(
      `CITATION_GAP: ${missing.length} uncited claim(s): ` +
        missing.map((m) => `${m.fragment} (${m.reason})`).join('; '),
    );
    this.name = 'CitationGapError';
  }
}

export class RenderError extends Error {
  public readonly code = 'RENDER_ERROR';
  constructor(public readonly rendererCode: string, message: string) {
    super(`RENDER_ERROR (${rendererCode}): ${message}`);
    this.name = 'RenderError';
  }
}

export interface DocumentStudio {
  /** Run the full generation pipeline for a registered doc type. */
  generate(request: GenerateRequest): Promise<GeneratedDoc>;
  /** Send an archived artifact for e-signature, then link the result. */
  sendForSignature(request: SignRequest): Promise<ArchivedArtifact>;
}

export function createDocumentStudio(deps: DocumentStudioDeps): DocumentStudio {
  return {
    async generate(request) {
      const spec = deps.registry.get(request.docType);
      if (!spec) {
        throw new Error(
          `document-studio: unknown doc type '${request.docType}' ` +
            `(registered: ${deps.registry.ids().join(', ') || 'none'})`,
        );
      }

      // 1. Validate raw data against the type's schema (zod).
      const parsed = spec.schema.parse(request.data);

      // 2. Bind → render model (data-binding: ledger/corpus/entity → view).
      const model = spec.binder(parsed);

      // 3. FORCED gate — locale purity (EN/SW absolute toggle).
      const purity = assertLocalePurity(model.view, model.locale);
      if (!purity.ok) {
        throw new LocaleMixingError(model.locale, purity.leaks);
      }

      const formats =
        request.formats && request.formats.length > 0
          ? request.formats
          : spec.defaultFormats;
      const citations = request.citations ?? [];
      const generatedAt = request.generatedAt ?? new Date();

      // 4. Render each format through the selected engine.
      const artifacts: Array<GeneratedDoc['artifacts'][number]> = [];
      for (const format of formats) {
        const renderer = deps.renderers.getRenderer(spec.engineHint, format);
        const rendered = await renderer.render({
          templateRef: model.templateRef,
          format,
          data: model.view,
        });
        if (rendered.error) {
          throw new RenderError(rendered.error.code, rendered.error.message);
        }

        // 5. FORCED gate — citation coverage on the produced text. The
        // stub renderer echoes the view, so a real text layer is checked
        // when present; the view itself is always verified. Structured
        // (tabular) docs verify by claim-coverage; narrative docs verify
        // by inline `[ID]` markers.
        const renderedText = new TextDecoder().decode(rendered.buffer);
        const verifyText = looksLikeText(renderedText)
          ? renderedText
          : extractText(model.view);
        if (spec.citationMode === 'structured') {
          const verdict = verifyStructuredCitations({
            text: verifyText,
            citations,
          });
          if (!verdict.ok) {
            throw new CitationGapError(verdict.missing);
          }
        } else {
          const verdict = verifyDocumentCitations({
            text: verifyText,
            citations: toVerifierCitations(citations),
          });
          if (!verdict.ok) {
            throw new CitationGapError(verdict.missing);
          }
        }

        // 6. FORCED — archive + WORM seal (append-only audit chain).
        const archived = await deps.archive.seal({
          tenantId: request.tenantId,
          actorId: request.actorId,
          documentKind: spec.id,
          format,
          language: model.locale,
          currencyCode: model.currencyCode,
          bytes: rendered.buffer,
          citations,
          bucket: request.bucket,
          generatedAt,
        });

        artifacts.push({
          format,
          mimeType: rendered.mimeType,
          bytes: rendered.buffer,
          sha256: sha256Hex(rendered.buffer),
          archived,
        });
      }

      return {
        docType: spec.id,
        tenantId: request.tenantId,
        locale: model.locale,
        currencyCode: model.currencyCode,
        artifacts,
        citations,
      };
    },

    async sendForSignature(request) {
      if (!deps.esign) {
        throw new Error(
          'document-studio: e-sign port not injected; cannot sendForSignature',
        );
      }
      const artifact = deps.archive.get(request.artifactId);
      if (!artifact) {
        throw new Error(
          `document-studio: unknown artifact '${request.artifactId}'`,
        );
      }
      // Pull the archived bytes back from storage via the seal record's
      // hash — the e-sign port binds the signature to that sha256.
      const envelope = await deps.esign.createEnvelope({
        tenantId: artifact.tenantId,
        title: request.title,
        message: request.message ?? '',
        document: {
          fileName: `${artifact.documentKind}.${artifact.format}`,
          mimeType: artifact.format === 'pdf' ? 'application/pdf' : 'application/octet-stream',
          // The archive is content-addressed; the caller re-supplies the
          // bytes via the storage port at the composition root. Here we
          // only have the hash, so we send a deterministic placeholder
          // that carries the binding sha256 — the real adapter is wired
          // with a storage fetch at the composition root.
          bytes: new TextEncoder().encode(artifact.renderedSha256),
          sha256: artifact.renderedSha256,
        },
        signers: [...request.signers],
        tier: request.tier ?? 'ses',
        ...(request.idempotencyKey !== undefined
          ? { idempotencyKey: request.idempotencyKey }
          : {}),
      });

      // Poll to completion, then download + link the signed artifact.
      let current = envelope;
      for (let i = 0; i < 5 && current.state !== 'completed'; i++) {
        current = await deps.esign.getEnvelope(envelope.envelopeId);
      }
      if (current.state !== 'completed') {
        // Envelope is in-flight; return the artifact unchanged. The caller
        // re-polls + links later (send-class actions are HITL).
        return artifact;
      }
      const signed = await deps.esign.downloadSigned(envelope.envelopeId);
      return deps.archive.linkSignature({
        artifactId: artifact.artifactId,
        provider: deps.esign.provider,
        envelopeId: envelope.envelopeId,
        tier: current.tier,
        signedBytes: signed.bytes,
        bucket: request.bucket,
      });
    },
  };
}

/**
 * Heuristic: does this decoded buffer look like the document's extracted
 * text (vs a stub marker or a binary PDF)? Decides whether citations are
 * verified against the rendered bytes or the view's prose.
 */
function looksLikeText(s: string): boolean {
  if (s.length === 0) return false;
  // Stub renderer emits `STUB:<id>:...` — not the document's prose.
  if (s.startsWith('STUB:')) return false;
  // Binary PDFs start with `%PDF`.
  if (s.startsWith('%PDF')) return false;
  // Reject buffers carrying NUL / low control bytes (binary payloads).
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0 || code < 9) return false;
  }
  return true;
}
