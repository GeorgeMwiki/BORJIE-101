/**
 * Legal draftsperson.
 *
 * Pipeline:
 *   1. Validate context (tenant, country).
 *   2. Budget guard.
 *   3. Global-first: resolve jurisdiction's lease-law snapshot via
 *      LeaseLawDispatchPort (NEVER hardcode Kenya/US defaults).
 *   4. LLM composes the first draft + cites required clauses.
 *   5. Autonomy decision — queue_for_review by default; auto-send ONLY when
 *      policy allows AND the kind is NOT in FORBIDDEN_AUTO_SEND.
 *   6. Persist immutable row.
 *
 * Every draft cites the statute it's satisfying so a landlord can click
 * through to the relevant law.
 */

import type { CostLedger } from '../../cost-ledger.js';
import { assertBudget, recordAiUsage } from '../phl-common/budget.js';
import {
  generateId,
  promptHashDjb2,
  type Citation,
  type AiNativeResult,
} from '../phl-common/types.js';
import {
  FORBIDDEN_AUTO_SEND,
  type AutonomyPolicyLookup,
  type DraftFacts,
  type LegalDocumentKind,
  type LegalDraftLLMOutput,
  type LegalDraftRepository,
  type LegalDraftRow,
  type LegalDrafterLLMPort,
  type LeaseLawDispatchPort,
  type TenantContextForLegal,
} from './types.js';

export interface LegalDrafterDeps {
  readonly ledger?: CostLedger;
  readonly llm: LegalDrafterLLMPort;
  readonly leaseLaw: LeaseLawDispatchPort;
  readonly autonomy?: AutonomyPolicyLookup;
  readonly repo: LegalDraftRepository;
  readonly now?: () => Date;
  readonly createdBy?: () => string | null;
}

export interface LegalDrafter {
  draft(input: {
    readonly documentKind: LegalDocumentKind;
    readonly context: TenantContextForLegal;
    readonly facts: DraftFacts;
    readonly correlationId?: string;
  }): Promise<AiNativeResult<LegalDraftRow>>;
}

function isForbiddenAutoSend(kind: LegalDocumentKind): boolean {
  return FORBIDDEN_AUTO_SEND.includes(kind);
}

function buildPrompt(
  kind: LegalDocumentKind,
  context: TenantContextForLegal,
  facts: DraftFacts,
  required: readonly string[],
): string {
  return [
    `kind:${kind}`,
    `tenant:${context.tenantId}`,
    `country:${context.countryCode}`,
    `subdivision:${context.subdivision ?? 'none'}`,
    `lang:${context.languageCode ?? 'auto'}`,
    `required:${required.join('|')}`,
    `facts:${JSON.stringify(facts)}`,
  ].join('\n');
}

export function createLegalDrafter(deps: LegalDrafterDeps): LegalDrafter {
  const now = deps.now ?? (() => new Date());
  const createdBy = deps.createdBy ?? (() => null);

  return {
    async draft(input) {
      if (!input.context?.tenantId || !input.context?.countryCode) {
        return {
          success: false,
          code: 'VALIDATION',
          message: 'tenantId and countryCode are required',
        };
      }

      const budgetContext = {
        tenantId: input.context.tenantId,
        operation: `ai-native.legal-drafter.${input.documentKind}`,
        correlationId: input.correlationId,
      };

      try {
        await assertBudget(deps, budgetContext);
      } catch (err) {
        if (
          err instanceof Error &&
          (err as { code?: string }).code === 'AI_BUDGET_EXCEEDED'
        ) {
          return {
            success: false,
            code: 'BUDGET_EXCEEDED',
            message: err.message,
          };
        }
        throw err;
      }

      // 3) Global-first dispatch
      let law;
      try {
        law = deps.leaseLaw.resolve(
          input.context.countryCode,
          input.documentKind,
          input.context.subdivision,
        );
      } catch (err) {
        return {
          success: false,
          code: 'VALIDATION',
          message:
            err instanceof Error
              ? err.message
              : `no lease-law plugin for country ${input.context.countryCode}`,
        };
      }

      const promptStr = buildPrompt(
        input.documentKind,
        input.context,
        input.facts,
        law.requiredClauses,
      );
      const hash = promptHashDjb2(promptStr);

      // 4) LLM compose
      let output: LegalDraftLLMOutput;
      try {
        output = await deps.llm.compose({
          documentKind: input.documentKind,
          context: input.context,
          facts: input.facts,
          law,
          promptHash: hash,
        });
      } catch (err) {
        return {
          success: false,
          code: 'UPSTREAM_ERROR',
          message:
            err instanceof Error ? err.message : 'legal drafter LLM error',
        };
      }

      await recordAiUsage(deps, budgetContext, {
        provider: 'ai-native',
        model: output.modelVersion,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        costUsdMicro: output.costUsdMicro,
      });

      // 5) Autonomy decision
      let autonomyDecision:
        | 'queued_for_review'
        | 'auto_send_allowed'
        | 'auto_send_forbidden' = 'queued_for_review';
      let needsHumanReview = true;

      if (isForbiddenAutoSend(input.documentKind)) {
        // Non-negotiable: eviction notices always require human review.
        autonomyDecision = 'auto_send_forbidden';
        needsHumanReview = true;
      } else if (deps.autonomy) {
        try {
          const allowed = await deps.autonomy.canAutoSend(
            input.context.tenantId,
            input.documentKind,
          );
          if (allowed) {
            autonomyDecision = 'auto_send_allowed';
            needsHumanReview = false;
          }
        } catch {
          // On any autonomy lookup error, fall back to human review.
          autonomyDecision = 'queued_for_review';
          needsHumanReview = true;
        }
      }

      const citations: Citation[] = law.citations.map((c) => ({
        kind: 'statute',
        ref: c,
        note: `cited by ${input.documentKind}`,
      }));

      const row: LegalDraftRow = Object.freeze({
        id: generateId('ldr'),
        tenantId: input.context.tenantId,
        documentKind: input.documentKind,
        countryCode: input.context.countryCode,
        jurisdictionMetadata: Object.freeze({
          subdivision: input.context.subdivision ?? null,
          sourceTag: law.sourceTag,
        }),
        subjectCustomerId: input.context.subjectCustomerId ?? null,
        subjectLeaseId: input.context.subjectLeaseId ?? null,
        subjectPropertyId: input.context.subjectPropertyId ?? null,
        subjectUnitId: input.context.subjectUnitId ?? null,
        languageCode: output.languageCode ?? input.context.languageCode ?? null,
        draftTitle: output.title,
        draftBody: output.body,
        requiredClauses: Object.freeze([...law.requiredClauses]),
        legalCitations: Object.freeze([...law.citations]),
        reviewFlags: Object.freeze([...output.reviewFlags]),
        needsHumanReview,
        status: 'draft',
        autonomyDecision,
        modelVersion: output.modelVersion,
        promptHash: hash,
        confidence: Math.max(0, Math.min(1, output.confidence)),
        context: Object.freeze({ ...(input.facts as Record<string, unknown>) }),
        createdBy: createdBy(),
        createdAt: now().toISOString(),
        citations: Object.freeze(citations),
      });

      await deps.repo.insert(row);

      return { success: true, data: row };
    },
  };
}
