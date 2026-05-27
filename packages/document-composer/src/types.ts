/**
 * `@borjie/document-composer` — types + Zod schemas.
 *
 * Single ergonomic façade over template / research / brand / render
 * packages. All public types live here; Zod schemas guard the
 * boundary so callers cannot smuggle malformed input past the
 * composer.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Render targets — closed set
// ---------------------------------------------------------------------------

export const RENDER_TARGETS = ['pdf', 'docx', 'pptx', 'html', 'md'] as const;
export type RenderTarget = (typeof RENDER_TARGETS)[number];

export const RenderTargetSchema = z.enum(RENDER_TARGETS);

// ---------------------------------------------------------------------------
// Citation
// ---------------------------------------------------------------------------

/**
 * A single research citation embedded in the composed document. Mirrors
 * the shape used by `@borjie/research-tools` but kept free of that
 * package's transitive deps so this façade stays light.
 */
export const CitationSchema = z.object({
  id: z.string().min(1),
  sourceUri: z.string().min(1),
  sourceTitle: z.string().min(1),
  /** ISO-8601. Defaults to "now" at compose time if not supplied. */
  accessedAt: z.string().min(1),
  /** sha256 hex of the citation's referenced span — for provenance. */
  contentHash: z.string().min(1),
  /** Optional human-readable excerpt — never required, never trusted. */
  excerpt: z.string().optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

// ---------------------------------------------------------------------------
// Research source — caller-supplied raw inputs that become Citations
// ---------------------------------------------------------------------------

export const ResearchSourceSchema = z.object({
  uri: z.string().min(1),
  title: z.string().min(1),
  /** Raw content body — used to compute the contentHash. */
  content: z.string().min(1),
  accessedAt: z.string().optional(),
  excerpt: z.string().optional(),
});

export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

// ---------------------------------------------------------------------------
// Provenance stamp
// ---------------------------------------------------------------------------

/**
 * Provenance metadata recorded on every composed document. The
 * stamp is signed into the hash-chain so downstream verifiers can
 * detect tampering.
 */
export const ProvenanceStampSchema = z.object({
  composerVersion: z.string().min(1),
  composedAt: z.string().min(1),
  tenantId: z.string().min(1),
  templateId: z.string().min(1),
  brandProfileId: z.string().min(1),
  persona: z.string().min(1),
  renderTarget: RenderTargetSchema,
  citationCount: z.number().int().min(0),
});

export type ProvenanceStamp = z.infer<typeof ProvenanceStampSchema>;

// ---------------------------------------------------------------------------
// Compose input
// ---------------------------------------------------------------------------

export const ComposeInputSchema = z.object({
  templateId: z.string().min(1),
  brandProfileId: z.string().min(1),
  renderTarget: RenderTargetSchema,
  persona: z.string().min(1),
  tenantId: z.string().min(1),
  researchSources: z.array(ResearchSourceSchema).default([]),
  /** Optional caller-supplied document title. */
  title: z.string().optional(),
  /** Optional extra payload forwarded to the template. */
  variables: z.record(z.string(), z.unknown()).optional(),
});

export type ComposeInput = z.infer<typeof ComposeInputSchema>;

// ---------------------------------------------------------------------------
// Composed document — the canonical output of composeDocument()
// ---------------------------------------------------------------------------

/**
 * Hash-chain entry shape — kept structural so we don't pin the
 * audit-hash-chain runtime type into our public surface.
 */
export interface ComposedDocumentChainEntry {
  readonly index: number;
  readonly prevHash: string;
  readonly rowHash: string;
  readonly sealedAtIso: string;
}

export interface ComposedDocument {
  readonly id: string;
  readonly content: string;
  readonly renderTarget: RenderTarget;
  readonly provenance: ProvenanceStamp;
  readonly citations: ReadonlyArray<Citation>;
  readonly hashChain: ReadonlyArray<ComposedDocumentChainEntry>;
}

// ---------------------------------------------------------------------------
// Ports — every external dep is behind a Port so we don't pin a
// transitive package's runtime type and so tests can stub freely.
// ---------------------------------------------------------------------------

export interface TemplateDescriptor {
  readonly id: string;
  readonly body: string;
}

export interface TemplateRegistryPort {
  /** Resolve template; return undefined if not found. */
  resolve(args: {
    readonly templateId: string;
    readonly tenantId: string;
  }): Promise<TemplateDescriptor | undefined>;
}

export interface BrandProfile {
  readonly id: string;
  readonly tenantId: string;
  readonly displayName: string;
  /** True iff this brand is currently locked (admin-only changes). */
  readonly locked: boolean;
}

export interface BrandResolverPort {
  /** Resolve brand for tenant; return undefined if not found. */
  resolve(args: {
    readonly brandProfileId: string;
    readonly tenantId: string;
  }): Promise<BrandProfile | undefined>;
}

export interface RenderRequest {
  readonly templateBody: string;
  readonly target: RenderTarget;
  readonly brand: BrandProfile;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly persona: string;
  readonly tenantId: string;
}

export interface RenderResult {
  readonly content: string;
}

export interface RendererPort {
  render(req: RenderRequest): Promise<RenderResult>;
}

export interface OcsfEvent {
  readonly tenantId: string;
  readonly action: string;
  readonly outcome: 'success' | 'failure';
  readonly resourceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface OcsfEmitterPort {
  emit(event: OcsfEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable, identity-checkable error codes — callers downstream key off
 * these instead of `instanceof` across module boundaries.
 */
export const ERROR_CODES = {
  missingTemplate: 'document_composer.missing_template',
  brandLockViolation: 'document_composer.brand_lock_violation',
  citationNotFound: 'document_composer.citation_not_found',
  invalidInput: 'document_composer.invalid_input',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class DocumentComposerError extends Error {
  public override readonly name: string;
  public readonly code: ErrorCode;
  public readonly meta: Readonly<Record<string, unknown>>;

  public constructor(
    name: string,
    code: ErrorCode,
    message: string,
    meta: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = name;
    this.code = code;
    this.meta = meta;
  }
}

export class MissingTemplateError extends DocumentComposerError {
  public constructor(templateId: string, tenantId: string) {
    super(
      'MissingTemplateError',
      ERROR_CODES.missingTemplate,
      `template "${templateId}" not found for tenant "${tenantId}"`,
      { templateId, tenantId },
    );
  }
}

export class BrandLockViolationError extends DocumentComposerError {
  public constructor(brandProfileId: string, tenantId: string, reason: string) {
    super(
      'BrandLockViolationError',
      ERROR_CODES.brandLockViolation,
      `brand-lock violation for "${brandProfileId}" (tenant "${tenantId}"): ${reason}`,
      { brandProfileId, tenantId, reason },
    );
  }
}

export class CitationNotFoundError extends DocumentComposerError {
  public constructor(uri: string, tenantId: string) {
    super(
      'CitationNotFoundError',
      ERROR_CODES.citationNotFound,
      `citation source "${uri}" not found (tenant "${tenantId}")`,
      { uri, tenantId },
    );
  }
}

export class InvalidComposeInputError extends DocumentComposerError {
  public constructor(message: string, issues: ReadonlyArray<unknown>) {
    super('InvalidComposeInputError', ERROR_CODES.invalidInput, message, {
      issues,
    });
  }
}
