/**
 * @borjie/document-studio — public surface.
 *
 * The generation pipeline for an open-ended set of document types:
 *
 *   request → doc-type registry → schema validate → data-binding →
 *   locale-purity gate → renderer-factory (PDF/DOCX/XLSX) → citation
 *   verify → immutable archive + WORM audit-hash linkage → e-sign port
 *
 * The studio owns no transport. Renderers, the artifact archive, and the
 * e-signature port are injected so production binds real backends and
 * tests bind stubs/fakes — and so the package stays dependency-light
 * (zod only) and never reaches a database or a vendor SDK directly.
 *
 * Quick start (stub everything — safe in any environment):
 *
 *   const studio = createDocumentStudioWithCoreTypes();
 *   const out = await studio.generate({ docType: 'royalty_statement', ... });
 *
 * Infinite types: register a bespoke type at runtime —
 *
 *   studio.registry.register({ id, title, schema, binder, engineHint,
 *                              defaultFormats, authored: true });
 */

// ── Core contracts ──────────────────────────────────────────────────
export * from './types.js';
export * from './format.js';

// ── Doc-type registry + data-binding ────────────────────────────────
export {
  createDocTypeRegistry,
  ENGINE_HINTS,
  type DocTypeRegistry,
  type DocTypeSpec,
  type DocBinder,
  type DocumentModel,
  type EngineHint,
} from './registry/doc-type.js';
export {
  bindMoney,
  bindNumber,
  bindCitations,
  bindLedgerTotal,
  selectLabels,
  localeTag,
  type DocLocale,
  type LedgerLine,
} from './registry/data-binding.js';
export {
  CORE_DOC_TYPES,
  registerCoreDocTypes,
  licenceApplicationDocType,
  royaltyStatementDocType,
  monthlyOwnerReportDocType,
} from './registry/core-doc-types.js';
export {
  offtakeSettlementDocType,
  toOfftakeSettlementView,
  OFFTAKE_SETTLEMENT_TEMPLATE_REF,
} from './templates/offtake-settlement/builder.js';

// ── Renderers + factory ─────────────────────────────────────────────
export { CarboneRenderer } from './renderers/carbone-renderer.js';
export { TypstRenderer } from './renderers/typst-renderer.js';
export { PdfFromHtmlRenderer } from './renderers/pdf-from-html-renderer.js';
export { ReportEngineRenderer } from './renderers/report-engine-renderer.js';
export {
  createRendererFactory,
  createDefaultRendererSet,
  createRealRendererSet,
  type RendererFactory,
  type RendererSet,
} from './renderers/renderer-factory.js';

// ── E-signature port + adapters ─────────────────────────────────────
export {
  SIGNATURE_TIERS,
  ENVELOPE_STATES,
  type ESignPort,
  type ESignRequest,
  type ESignEnvelope,
  type SignedArtifact,
  type Signer,
  type SignatureTier,
  type EnvelopeState,
} from './esign/port.js';
export {
  createDropboxSignAdapter,
  type DropboxSignConfig,
} from './esign/dropbox-sign-adapter.js';
export {
  createMockESignAdapter,
  type MockESignOptions,
} from './esign/mock-adapter.js';

// ── Archive + audit-hash linkage ────────────────────────────────────
export {
  createArtifactArchive,
  createInMemoryArchiveStorage,
  archiveStorageKey,
  type ArtifactArchive,
  type ArchivedArtifact,
  type ArchiveStoragePort,
  type SealInput,
} from './archive/artifact-archive.js';
export {
  createInMemoryWormAuditStore,
  citationsSha256,
  type WormAuditEntry,
  type WormAuditStore,
} from './signing/worm-audit.js';

// ── Pipeline (studio) + gates ───────────────────────────────────────
export {
  createDocumentStudio,
  LocaleMixingError,
  CitationGapError,
  RenderError,
  type DocumentStudio,
  type DocumentStudioDeps,
  type GenerateRequest,
  type GeneratedDoc,
  type SignRequest,
} from './pipeline/studio.js';
export {
  assertLocalePurity,
  extractText,
  type LocalePurityResult,
} from './pipeline/locale-purity.js';
export {
  verifyStructuredCitations,
  type StructuredCitationVerdict,
} from './pipeline/structured-citation-gate.js';
export {
  toVerifierCitation,
  toVerifierCitations,
} from './citations/adapt.js';
export {
  verifyDocumentCitations,
  sha256Hex,
  type VerifyArgs,
  type VerifyResult,
} from './citations/citation-verifier.js';

// ── Convenience composition ─────────────────────────────────────────

import { createDocTypeRegistry, type DocTypeRegistry } from './registry/doc-type.js';
import { registerCoreDocTypes } from './registry/core-doc-types.js';
import {
  createDefaultRendererSet,
  createRealRendererSet,
  createRendererFactory,
} from './renderers/renderer-factory.js';
import {
  createArtifactArchive,
  createInMemoryArchiveStorage,
  type ArchiveStoragePort,
} from './archive/artifact-archive.js';
import { createInMemoryWormAuditStore } from './signing/worm-audit.js';
import {
  createDocumentStudio,
  type DocumentStudio,
} from './pipeline/studio.js';
import type { ESignPort } from './esign/port.js';

/**
 * Assemble a ready-to-use studio with the core doc types registered.
 *
 * Renderer selection:
 *   - `useStub: true` (or an explicit stub set) → the deterministic offline
 *     stub renderers that emit `STUB:<id>:...` placeholder bytes. Safe for
 *     unit tests that only exercise the pipeline gates, never the bytes.
 *   - `useStub: false` / unset → the REAL, dependency-free `ReportEngineRenderer`
 *     that synthesizes GENUINE documents (real OOXML zip for docx/xlsx/pptx,
 *     real `%PDF`, real HTML). This is what the composition root wires so
 *     `mining.document.generate` returns an openable document, not a stub.
 *
 * The archive stays in-memory by default (inject `storage` for production).
 * The returned `registry` lets callers add authored types.
 */
export function createDocumentStudioWithCoreTypes(deps?: {
  readonly registry?: DocTypeRegistry;
  readonly renderers?: ReturnType<typeof createRendererFactory>;
  readonly storage?: ArchiveStoragePort;
  readonly esign?: ESignPort;
  readonly useStub?: boolean;
}): DocumentStudio & { readonly registry: DocTypeRegistry } {
  const registry = deps?.registry ?? createDocTypeRegistry();
  registerCoreDocTypes(registry);

  const renderers =
    deps?.renderers ??
    createRendererFactory(
      deps?.useStub === true
        ? createDefaultRendererSet({ useStub: true })
        : createRealRendererSet(),
    );

  const archive = createArtifactArchive({
    worm: createInMemoryWormAuditStore(),
    storage: deps?.storage ?? createInMemoryArchiveStorage(),
  });

  const studio = createDocumentStudio({
    registry,
    renderers,
    archive,
    ...(deps?.esign ? { esign: deps.esign } : {}),
  });

  return Object.assign(studio, { registry });
}
