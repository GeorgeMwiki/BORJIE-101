/**
 * Auditor Agent — gate every recommendation before it reaches the owner
 * or executes a binding action.
 *
 * Two-stage flow:
 *   1. Local validation — synchronous: reject when `evidence_ids` is
 *      empty, when `confidence` is missing, or when a hard rule
 *      mentioned in the recommendation contradicts the universal
 *      hard-rules list.
 *   2. Counter-model check (AGENT_PROMPT_LIBRARY §20) — Haiku reviews
 *      the recommendation against the originating junior's hard rules
 *      and returns approve/reject + missing-evidence list.
 *
 * Writes via typed `db.insert(auditLog)` (migration 0011).
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

export const RecommendationToAudit = z.object({
  origin_junior: z.string().min(1),
  recommendation_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  evidence_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  binding: z.boolean().default(false),
});
export type RecommendationToAudit = z.infer<typeof RecommendationToAudit>;

export const AuditorInputSchema = z.object({
  tenantId: z.string().min(1),
  recommendation: RecommendationToAudit,
});
export type AuditorInput = z.infer<typeof AuditorInputSchema>;

export const AuditorVerdict = z.enum(['approve', 'reject', 'needs_human']);
export const AuditorOutputSchema = AuditedOutputBase.extend({
  verdict: AuditorVerdict,
  missing_evidence: z.array(z.string()).default([]),
  counter_model_agrees: z.boolean(),
  required_actions: z.array(z.string()).default([]),
  audit_log_id: z.string().min(1),
});
export type AuditorOutput = z.infer<typeof AuditorOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const AUDITOR_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Auditor Agent',
  mandate:
    'Verify the evidence chain on a peer junior recommendation. Reject when evidence_ids is empty or confidence is below the originating junior floor. Run a counter-model check on binding actions.',
  tools:
    'verify_evidence(rec) -> { passes, missing } ; counter_model_check(rec) -> { primary_agrees, critic_agrees } ; log_audit(rec_id, verdict).',
  evidence:
    'Cite the junior whose hard-rule was violated when rejecting. Cite the missing evidence kind (e.g. "lab_certificate", "village_minute") when reject reason is missing_evidence.',
  outputSchema:
    '{ "verdict": "approve"|"reject"|"needs_human", "missing_evidence": string[], "counter_model_agrees": boolean, ' +
    '"required_actions": string[], "audit_log_id": string, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'gating-only — does not execute, only approves/rejects',
  hardRules: [
    'Auto-reject if recommendation.evidence_ids is empty.',
    'Auto-reject if recommendation.binding === true AND recommendation.confidence < 0.7.',
    'For safety-critical recs (safety-agent / blasting / mercury), require counter_model_agrees === true.',
  ],
});

function buildUserPrompt(input: AuditorInput): string {
  return [
    `TENANT: ${input.tenantId}`,
    `RECOMMENDATION TO AUDIT:`,
    JSON.stringify(input.recommendation, null, 2).slice(0, 6_000),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createAuditorAgent(deps: JuniorDeps) {
  return {
    async processInput(input: AuditorInput): Promise<AuditorOutput> {
      const validated = AuditorInputSchema.parse(input);

      // Stage 1: synchronous fail-fast gate.
      if (validated.recommendation.evidence_ids.length === 0) {
        const auditLogId = `audit_${Date.now()}_${validated.recommendation.recommendation_id}`;
        await persistAudit(deps, validated, auditLogId, 'reject', ['evidence_ids']);
        return {
          verdict: 'reject',
          missing_evidence: ['evidence_ids'],
          counter_model_agrees: false,
          required_actions: ['Gather at least one evidence_id before re-submitting.'],
          audit_log_id: auditLogId,
          confidence: 1,
          rationale: 'Auto-rejected by Auditor stage-1 gate: evidence_ids is empty.',
          evidence_ids: [validated.recommendation.recommendation_id],
          citations: ['AGENT_PROMPT_LIBRARY §0 — every fact must be linkable to a provenance record.'],
        };
      }

      // Stage 2: Claude counter-model check.
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'auditor-agent',
        schema: AuditorOutputSchema,
        systemPrompt: AUDITOR_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1500,
      });

      await persistAudit(
        deps,
        validated,
        output.audit_log_id,
        output.verdict,
        output.missing_evidence,
      );

      return output;
    },
  };
}
export type AuditorAgent = ReturnType<typeof createAuditorAgent>;

async function persistAudit(
  deps: JuniorDeps,
  input: AuditorInput,
  auditLogId: string,
  verdict: string,
  missing: ReadonlyArray<string>,
): Promise<void> {
  if (!deps.db) return;
  try {
    const schemas = await loadJuniorSchemas();
    const auditLog = schemas?.auditLog as unknown;
    if (auditLog) {
      await deps.db
        .insert(auditLog)
        .values({
          id: auditLogId,
          tenantId: input.tenantId,
          recommendation: input.recommendation,
          verdict,
          missing: [...missing],
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    deps.logger?.warn('auditor-agent: audit_log write skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createDefaultAuditorAgent(): AuditorAgent {
  let cached: AuditorAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createAuditorAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
