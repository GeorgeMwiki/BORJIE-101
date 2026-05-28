/**
 * Free-form drafter brain tool — `mining.drafts.compose_free_form`.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Registered alongside the v1 template-
 * driven tools (`skill.docs.draft_*`) via `setBrainExtraSkills`.
 *
 * The handler resolves the per-request tenant id / actor id from the
 * `context` argument passed by the brain runtime, so a single handler
 * instance is safe across tenants. RLS at the database layer enforces
 * tenant isolation on every insert.
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import type { DraftPersistence } from './index.js';
import { createDocumentDrafter, type SemanticBlockGenerator } from './index.js';
import { composeFreeForm, type FreeFormContextDoc } from './free-form-composer.js';
import type { RevisionsPersistence } from './revisions-persistence.js';

export interface FreeFormBrainToolDeps {
  readonly persistence: DraftPersistence;
  readonly revisionsPersistence: RevisionsPersistence;
  readonly defaultGenerator?: SemanticBlockGenerator;
}

export function buildFreeFormDrafterTool(
  deps: FreeFormBrainToolDeps,
): ToolHandler {
  const drafter = createDocumentDrafter({
    persistence: deps.persistence,
    ...(deps.defaultGenerator !== undefined
      ? { defaultGenerator: deps.defaultGenerator }
      : {}),
  });
  void drafter;

  const handler: ToolHandler = {
    name: 'mining.drafts.compose_free_form',
    description:
      'Compose a free-form document from a natural-language intent. Use this when no template fits (e.g. "draft a letter to TRA explaining the late February royalty filing"). Returns the markdown plus inferred title/kind and the citations the brain pulled.',
    parameters: {
      type: 'object',
      required: ['intent'],
      properties: {
        intent: { type: 'string', description: 'Owner\'s natural-language ask.' },
        contextDocs: {
          type: 'array',
          description: 'Corpus chunks / owner docs the brain may cite.',
        },
        targetFormat: {
          type: 'string',
          enum: ['md', 'pdf', 'docx', 'pptx', 'html'],
          description: 'Preferred render format the caller plans to use next.',
        },
        brandStyle: {
          type: 'string',
          enum: ['corporate', 'warm', 'regulator'],
          description: 'Tone preset.',
        },
        language: {
          type: 'string',
          enum: ['sw', 'en', 'bilingual'],
          description: 'Document language (default en).',
        },
        citationMode: {
          type: 'string',
          enum: ['inline', 'footnote', 'none'],
        },
      },
    },
    async execute(params, context) {
      try {
        const intent =
          typeof params['intent'] === 'string' ? (params['intent'] as string) : '';
        if (!intent || intent.trim().length === 0) {
          return { ok: false, error: 'intent is required' };
        }
        const language =
          typeof params['language'] === 'string' &&
          (params['language'] === 'sw' ||
            params['language'] === 'en' ||
            params['language'] === 'bilingual')
            ? (params['language'] as 'sw' | 'en' | 'bilingual')
            : 'en';
        const contextDocs = Array.isArray(params['contextDocs'])
          ? (params['contextDocs'] as ReadonlyArray<FreeFormContextDoc>)
          : undefined;

        const composed = await composeFreeForm({
          tenantId: context.tenant.tenantId,
          ownerId: context.actor.id,
          intent,
          language,
          ...(contextDocs ? { contextDocs } : {}),
          ...(deps.defaultGenerator ? { generator: deps.defaultGenerator } : {}),
        });

        const inserted = await deps.persistence.insert({
          tenantId: context.tenant.tenantId,
          createdByUserId: context.actor.id,
          kind: composed.inferredKind,
          status: 'drafting',
          titleSw: composed.inferredTitle,
          titleEn: composed.inferredTitle,
          jurisdiction: 'TZ',
          language,
          contentMd: composed.markdown,
          sourceTemplateSlug: null,
          revisionCount: 1,
          lastRevisedAt: new Date(),
          parentDraftId: null,
        } as never);

        const revision = await deps.revisionsPersistence.insertRevision({
          tenantId: context.tenant.tenantId,
          draftId: inserted.id,
          revisionNo: 1,
          contentMd: composed.markdown,
          contentFormat: 'markdown',
          createdBy: context.actor.id,
          citations: composed.citations.map((c) => ({
            sourceKind: c.sourceKind,
            sourceRef: c.sourceRef,
            snippetUsed: c.snippetUsed ?? null,
          })),
        });
        for (const cite of composed.citations) {
          await deps.revisionsPersistence.insertCitation({
            tenantId: context.tenant.tenantId,
            draftId: inserted.id,
            revisionId: revision.id,
            sourceKind: cite.sourceKind,
            sourceRef: cite.sourceRef,
            snippetUsed: cite.snippetUsed ?? null,
          });
        }

        return {
          ok: true,
          data: {
            draftId: inserted.id,
            inferredTitle: composed.inferredTitle,
            inferredKind: composed.inferredKind,
            sections: composed.sections.length,
            citationsCount: composed.citations.length,
            preview: composed.markdown.slice(0, 600),
          },
          evidenceSummary: `Composed free-form draft "${composed.inferredTitle}" for tenant ${context.tenant.tenantId}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
  return handler;
}
