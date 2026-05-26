/**
 * Community Agent — village meetings, CSR plans, grievance tracking
 * (AGENT_PROMPT_LIBRARY §19).
 *
 * Distinct from village-csr-agent: community-agent owns the grievance
 * register + landowner relations + Swahili translation surface; the
 * village-csr-agent owns the CSR-delivery dashboard + commitment %.
 *
 * Schema gap: `grievance_records` raw SQL; TODO(#30).
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

export const GrievanceKind = z.enum([
  'land_use_overlap',
  'water_contamination',
  'dust_noise',
  'compensation_dispute',
  'cultural_site_disturbance',
  'employment_promise',
  'csr_delivery_gap',
  'safety_concern',
  'other',
]);

export const Grievance = z.object({
  grievance_id: z.string().min(1),
  raised_at: z.string(),
  village_id: z.string().optional(),
  complainant_name: z.string().optional(),
  kind: GrievanceKind,
  description_swahili: z.string().min(1),
  status: z.enum(['open', 'mediation', 'resolved', 'escalated']),
});

export const CommunityInputSchema = z.object({
  tenantId: z.string().min(1),
  village_meetings_scheduled: z
    .array(z.object({ village_id: z.string(), date: z.string(), agenda: z.array(z.string()) }))
    .default([]),
  grievances: z.array(Grievance).default([]),
  csr_commitments: z
    .array(
      z.object({
        commitment_id: z.string(),
        kind: z.string(),
        budget_tzs: z.number().nonnegative(),
        promised_by: z.string(),
        delivered_pct: z.number().min(0).max(100),
      }),
    )
    .default([]),
});
export type CommunityInput = z.infer<typeof CommunityInputSchema>;

export const CommunityOutput = AuditedOutputBase.extend({
  grievance_summary: z.object({
    open: z.number().int().nonnegative(),
    in_mediation: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    escalated: z.number().int().nonnegative(),
  }),
  high_priority_grievances: z.array(z.string()),
  csr_delivery_gap_pct: z.number().min(0).max(100),
  meeting_minutes_required: z.array(z.string()),
  next_actions_swahili: z.array(z.string()),
  next_actions_english: z.array(z.string()),
});
export type CommunityOutput = z.infer<typeof CommunityOutput>;

export const COMMUNITY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Community Agent',
  mandate:
    'Maintain a legitimate, accessible, predictable, equitable, transparent, rights-compatible, engagement-based grievance register (ICMM + UNGP). Track CSR delivery vs commitment. Translate all owner-facing output to Swahili by default.',
  tools: 'list_grievances, log_grievance, mediate, escalate, csr_delivery_gap, translate_message.',
  evidence:
    'Cite the grievance_id for every priority call. Cite the commitment_id for every CSR gap. ' +
    'Cite the ICMM Community Grievance Mechanism guidance for any framework decision.',
  outputSchema:
    '{ "grievance_summary": {open,int,mediation,resolved,escalated}, "high_priority_grievances": string[], ' +
    '"csr_delivery_gap_pct": number, "meeting_minutes_required": string[], ' +
    '"next_actions_swahili": string[], "next_actions_english": string[], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'advisory + grievance triage; never closes a grievance without owner approval',
  hardRules: [
    'Always translate owner-facing replies to Swahili by default.',
    'Watch land-use overlaps: villager farms / grazing routes / footpaths / cultural sites within licence polygon.',
    'Escalate any grievance kind in {water_contamination, cultural_site_disturbance, safety_concern}.',
  ],
});

function buildUserPrompt(input: CommunityInput): string {
  return [
    `TENANT: ${input.tenantId}`,
    `MEETINGS (${input.village_meetings_scheduled.length}):`,
    JSON.stringify(input.village_meetings_scheduled, null, 2).slice(0, 1_500),
    `GRIEVANCES (${input.grievances.length}):`,
    JSON.stringify(input.grievances, null, 2).slice(0, 3_000),
    `CSR_COMMITMENTS (${input.csr_commitments.length}):`,
    JSON.stringify(input.csr_commitments, null, 2).slice(0, 2_000),
  ].join('\n');
}

export function createCommunityAgent(deps: JuniorDeps) {
  return {
    async processInput(input: CommunityInput): Promise<CommunityOutput> {
      const validated = CommunityInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'community-agent',
        schema: CommunityOutput,
        systemPrompt: COMMUNITY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(#30): typed insert against `grievance_records`.
          await deps.db.execute(
            sql`INSERT INTO grievance_records
                  (id, tenant_id, summary, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${summary}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('community-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type CommunityAgent = ReturnType<typeof createCommunityAgent>;

export function createDefaultCommunityAgent(): CommunityAgent {
  let cached: CommunityAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createCommunityAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
