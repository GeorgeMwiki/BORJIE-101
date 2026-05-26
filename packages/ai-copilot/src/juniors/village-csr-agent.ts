/**
 * Village CSR Agent — CSR delivery dashboard, commitment completion %
 * (AGENT_PROMPT_LIBRARY §4).
 *
 * Mining Act s.105 + Mining (CSR) Regulations 2023 + March-2026 High
 * Court ruling on allocation flexibility:
 *   - 14 days CSR Committee → 7 days District Council → 30 days to two
 *     responsible Ministers.
 *   - Original 40 % village / 60 % district split now negotiable.
 *
 * Schema gap: `csr_plans`, `csr_meetings` raw SQL; TODO(#30).
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const CsrProjectKind = z.enum([
  'borehole',
  'classroom',
  'dispensary',
  'road_grading',
  'electrification',
  'agricultural_inputs',
  'water_tank',
  'desk_kit',
  'teacher_house',
  'other',
]);

export const CsrCommitment = z.object({
  commitment_id: z.string().min(1),
  village_id: z.string().min(1),
  kind: CsrProjectKind,
  budget_tzs: z.number().nonnegative(),
  promised_at: z.string(),
  due_at: z.string(),
  delivered_pct: z.number().min(0).max(100),
  receipts_evidence_ids: z.array(z.string()).default([]),
});

export const VillageCsrInputSchema = z.object({
  tenantId: z.string().min(1),
  licenceId: z.string().min(1),
  commitments: z.array(CsrCommitment).min(1),
  csr_plan_filed_at: z.string().nullable(),
  committee_meeting_at: z.string().nullable(),
  council_meeting_at: z.string().nullable(),
  minister_review_at: z.string().nullable(),
});
export type VillageCsrInput = z.infer<typeof VillageCsrInputSchema>;

export const VillageCsrOutput = AuditedOutputBase.extend({
  licence_id: z.string(),
  overall_delivery_pct: z.number().min(0).max(100),
  delivery_by_kind: z.array(
    z.object({ kind: CsrProjectKind, delivered_pct: z.number().min(0).max(100), total_budget_tzs: z.number().nonnegative() }),
  ),
  csr_clock_status: z.enum(['not_filed', 'in_committee', 'in_council', 'with_ministers', 'approved', 'overdue']),
  next_milestone_due: z.string().nullable(),
  flagged_commitments: z.array(z.string()),
  fingerprint_letter_required: z.boolean(),
});
export type VillageCsrOutput = z.infer<typeof VillageCsrOutput>;

export const VILLAGE_CSR_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Village CSR Agent',
  mandate:
    'Run the CSR delivery dashboard: commitment completion %, CSR-clock status (14d committee → 7d council → 30d ministers), and pre-flight the fingerprint-attested village agreement letter.',
  tools:
    'schedule_meeting, draft_minutes_template, capture_fingerprint, compose_csr_plan, start_csr_clock, list_csr_project_library.',
  evidence:
    'Every commitment must cite the village meeting minutes evidence_id + receipt evidence_id. ' +
    'Cite Mining (CSR) Regulations 2023 + March-2026 High Court ruling for any allocation discussion.',
  outputSchema:
    '{ "licence_id": string, "overall_delivery_pct": number, "delivery_by_kind": [...], ' +
    '"csr_clock_status": "not_filed"|"in_committee"|"in_council"|"with_ministers"|"approved"|"overdue", ' +
    '"next_milestone_due": string|null, "flagged_commitments": string[], "fingerprint_letter_required": boolean, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'dashboard + drafting only; never marks a commitment delivered without receipt evidence',
  hardRules: [
    'Fingerprint flow requires officials pre-enrolled by an authorised operator — do NOT bypass.',
    'Letter wording: "agreed at village government meeting, fingerprint-attested" — never claim government endorsement Borjie does not have.',
    'Allocation split is negotiable post-March-2026 High Court ruling; advise, do not assume.',
    'Quorum check: half-plus-one of registered village adults before commitments are binding.',
  ],
});

function buildUserPrompt(input: VillageCsrInput): string {
  return [
    `TENANT: ${input.tenantId}  LICENCE: ${input.licenceId}`,
    `CSR_PLAN_FILED: ${input.csr_plan_filed_at ?? 'not filed'}`,
    `COMMITTEE: ${input.committee_meeting_at ?? '-'}  COUNCIL: ${input.council_meeting_at ?? '-'}  MINISTERS: ${input.minister_review_at ?? '-'}`,
    `COMMITMENTS (${input.commitments.length}):`,
    JSON.stringify(input.commitments, null, 2).slice(0, 3_500),
  ].join('\n');
}

export function createVillageCsrAgent(deps: JuniorDeps) {
  return {
    async processInput(input: VillageCsrInput): Promise<VillageCsrOutput> {
      const validated = VillageCsrInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'village-csr-agent',
        schema: VillageCsrOutput,
        systemPrompt: VILLAGE_CSR_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(#30): typed insert against `csr_plans`.
          await deps.db.execute(
            sql`INSERT INTO csr_plans
                  (id, tenant_id, licence_id, status, delivered_pct, summary, computed_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.licenceId},
                        ${output.csr_clock_status}, ${output.overall_delivery_pct},
                        ${summary}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('village-csr-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type VillageCsrAgent = ReturnType<typeof createVillageCsrAgent>;

export function createDefaultVillageCsrAgent(): VillageCsrAgent {
  let cached: VillageCsrAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createVillageCsrAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
