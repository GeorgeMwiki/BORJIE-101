/**
 * `@borjie/document-composer` — public surface.
 *
 * One ergonomic façade across the document-templates / document-studio
 * / document-ai / document-analysis / document-quality-guarantor /
 * executive-brief-engine / report-engine / presentation-engine /
 * content-studio / marketing-studio / research-tools packages.
 *
 * Every emitted document carries:
 *   - a Zod-validated `ComposeInput` at the boundary
 *   - a `ProvenanceStamp` (composer version, tenant, persona, target)
 *   - citation rows with `sourceUri`, `sourceTitle`, `accessedAt`,
 *     `contentHash` per `ResearchSource`
 *   - a 2-row hash chain sealed via `@borjie/audit-hash-chain`
 *   - an optional OCSF event via `@borjie/ocsf-emitter`
 *
 * The composer is tenant-isolated — `tenantId` is mandatory on every
 * call and is enforced on brand-profile resolution.
 */

// ── Factory + main entrypoint ─────────────────────────────────────────
export {
  createDocumentComposer,
  composeDocument,
  type DocumentComposer,
  type DocumentComposerDeps,
} from './composer.js';

// ── Citation stamper internals (re-exported for advanced callers) ────
export {
  hashContent,
  stampCitations,
  sealComposedDocument,
} from './citation-stamper.js';

// ── Public types ──────────────────────────────────────────────────────
export {
  RENDER_TARGETS,
  RenderTargetSchema,
  CitationSchema,
  ResearchSourceSchema,
  ProvenanceStampSchema,
  ComposeInputSchema,
  ERROR_CODES,
} from './types.js';

export type {
  RenderTarget,
  Citation,
  ResearchSource,
  ProvenanceStamp,
  ComposeInput,
  ComposedDocument,
  ComposedDocumentChainEntry,
  TemplateDescriptor,
  TemplateRegistryPort,
  BrandProfile,
  BrandResolverPort,
  RenderRequest,
  RenderResult,
  RendererPort,
  OcsfEvent,
  OcsfEmitterPort,
  ErrorCode,
} from './types.js';

// ── Errors ────────────────────────────────────────────────────────────
export {
  DocumentComposerError,
  MissingTemplateError,
  BrandLockViolationError,
  CitationNotFoundError,
  InvalidComposeInputError,
} from './types.js';
