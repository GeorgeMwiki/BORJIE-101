/**
 * Document Composer — factory + composeDocument().
 *
 * Thin façade unifying the existing template / brand / research /
 * render packages. Every emitted document carries a provenance stamp,
 * cited research sources, and a tenant-isolated hash chain.
 *
 * Implementation note: all wrapped packages are reached via Ports so
 * this façade does not directly import them. That keeps the
 * dependency surface narrow (the only hard deps are
 * `@borjie/audit-hash-chain` for chain sealing and
 * `@borjie/ocsf-emitter` for the SIEM event). Callers wire real
 * adapters from the heavyweight packages when they construct the
 * composer.
 */

import { randomUUID } from 'node:crypto';
import {
  BrandLockViolationError,
  ComposeInputSchema,
  InvalidComposeInputError,
  MissingTemplateError,
  type BrandResolverPort,
  type ComposeInput,
  type ComposedDocument,
  type OcsfEmitterPort,
  type ProvenanceStamp,
  type RendererPort,
  type TemplateRegistryPort,
} from './types.js';
import { sealComposedDocument, stampCitations } from './citation-stamper.js';

const COMPOSER_VERSION = '0.1.0';

export interface DocumentComposerDeps {
  readonly templateRegistry: TemplateRegistryPort;
  readonly brandResolver: BrandResolverPort;
  readonly renderer: RendererPort;
  /** Optional — if omitted, the composer is silent on the SIEM bus. */
  readonly ocsfEmitter?: OcsfEmitterPort;
  /** Override clock for deterministic tests. */
  readonly clock?: () => Date;
  /** Override id generator for deterministic tests. */
  readonly idGenerator?: () => string;
}

export interface DocumentComposer {
  composeDocument(input: ComposeInput): Promise<ComposedDocument>;
}

/**
 * Validate at the boundary using Zod. Throws
 * `InvalidComposeInputError` (wrapping the issues) on failure.
 */
function parseInput(input: ComposeInput): ComposeInput {
  const result = ComposeInputSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidComposeInputError(
      'composeDocument: input did not match ComposeInputSchema',
      result.error.issues,
    );
  }
  return result.data;
}

async function safeEmit(
  emitter: OcsfEmitterPort | undefined,
  args: {
    readonly tenantId: string;
    readonly outcome: 'success' | 'failure';
    readonly resourceId: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  if (emitter === undefined) {
    return;
  }
  try {
    await emitter.emit({
      tenantId: args.tenantId,
      action: 'document.composed',
      outcome: args.outcome,
      resourceId: args.resourceId,
      metadata: args.metadata,
    });
  } catch {
    // OCSF emission is fire-and-forget — never crash the compose path
    // because the SIEM bus is unavailable.
  }
}

export function createDocumentComposer(
  deps: DocumentComposerDeps,
): DocumentComposer {
  const clock = deps.clock ?? ((): Date => new Date());
  const idGenerator = deps.idGenerator ?? ((): string => randomUUID());

  async function composeDocument(
    rawInput: ComposeInput,
  ): Promise<ComposedDocument> {
    const input = parseInput(rawInput);
    const nowIso = clock().toISOString();
    const documentId = idGenerator();

    // ── Resolve template ────────────────────────────────────────────
    let template;
    try {
      template = await deps.templateRegistry.resolve({
        templateId: input.templateId,
        tenantId: input.tenantId,
      });
    } catch (error) {
      await safeEmit(deps.ocsfEmitter, {
        tenantId: input.tenantId,
        outcome: 'failure',
        resourceId: documentId,
        metadata: {
          stage: 'template_resolve',
          templateId: input.templateId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new MissingTemplateError(input.templateId, input.tenantId);
    }
    if (template === undefined) {
      await safeEmit(deps.ocsfEmitter, {
        tenantId: input.tenantId,
        outcome: 'failure',
        resourceId: documentId,
        metadata: { stage: 'template_resolve', templateId: input.templateId },
      });
      throw new MissingTemplateError(input.templateId, input.tenantId);
    }

    // ── Resolve brand + enforce brand-lock + tenant isolation ───────
    const brand = await deps.brandResolver.resolve({
      brandProfileId: input.brandProfileId,
      tenantId: input.tenantId,
    });
    if (brand === undefined) {
      await safeEmit(deps.ocsfEmitter, {
        tenantId: input.tenantId,
        outcome: 'failure',
        resourceId: documentId,
        metadata: {
          stage: 'brand_resolve',
          brandProfileId: input.brandProfileId,
        },
      });
      throw new BrandLockViolationError(
        input.brandProfileId,
        input.tenantId,
        'brand profile not found',
      );
    }
    if (brand.tenantId !== input.tenantId) {
      await safeEmit(deps.ocsfEmitter, {
        tenantId: input.tenantId,
        outcome: 'failure',
        resourceId: documentId,
        metadata: {
          stage: 'tenant_isolation',
          brandProfileId: input.brandProfileId,
          brandTenantId: brand.tenantId,
        },
      });
      throw new BrandLockViolationError(
        input.brandProfileId,
        input.tenantId,
        'brand profile belongs to a different tenant',
      );
    }

    // ── Stamp citations from research sources ───────────────────────
    const citations = stampCitations({
      sources: input.researchSources,
      tenantId: input.tenantId,
      nowIso,
    });

    // ── Render via the wrapped engine ───────────────────────────────
    let rendered;
    try {
      rendered = await deps.renderer.render({
        templateBody: template.body,
        target: input.renderTarget,
        brand,
        variables: input.variables ?? {},
        persona: input.persona,
        tenantId: input.tenantId,
      });
    } catch (error) {
      await safeEmit(deps.ocsfEmitter, {
        tenantId: input.tenantId,
        outcome: 'failure',
        resourceId: documentId,
        metadata: {
          stage: 'render',
          renderTarget: input.renderTarget,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new Error(
        `document-composer: renderer failed for target "${input.renderTarget}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // ── Build provenance + hash chain ───────────────────────────────
    const provenance: ProvenanceStamp = {
      composerVersion: COMPOSER_VERSION,
      composedAt: nowIso,
      tenantId: input.tenantId,
      templateId: input.templateId,
      brandProfileId: input.brandProfileId,
      persona: input.persona,
      renderTarget: input.renderTarget,
      citationCount: citations.length,
    };

    const hashChain = sealComposedDocument({
      provenance,
      citations,
      content: rendered.content,
      documentId,
      sealedAtIso: nowIso,
    });

    // ── Emit OCSF success event ─────────────────────────────────────
    await safeEmit(deps.ocsfEmitter, {
      tenantId: input.tenantId,
      outcome: 'success',
      resourceId: documentId,
      metadata: {
        stage: 'composed',
        renderTarget: input.renderTarget,
        templateId: input.templateId,
        brandProfileId: input.brandProfileId,
        citationCount: citations.length,
        chainLength: hashChain.length,
      },
    });

    return {
      id: documentId,
      content: rendered.content,
      renderTarget: input.renderTarget,
      provenance,
      citations,
      hashChain,
    };
  }

  return { composeDocument };
}

/**
 * Convenience wrapper for one-shot calls — constructs a composer and
 * immediately runs `composeDocument`. Used when the caller has no
 * reason to keep a composer around.
 */
export async function composeDocument(
  deps: DocumentComposerDeps,
  input: ComposeInput,
): Promise<ComposedDocument> {
  const composer = createDocumentComposer(deps);
  return composer.composeDocument(input);
}
