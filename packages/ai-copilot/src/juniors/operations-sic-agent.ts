/**
 * Operations / SIC Agent — Short Interval Control loop, hourly
 * supervisor pings, end-of-shift reconciliation, deviation explanation
 * (AGENT_PROMPT_LIBRARY §10).
 *
 * Modes:
 *   - "pre_shift": deliver plan
 *   - "ping": capture answer to "how many loads since last check?"
 *   - "reconcile": end-of-shift reconciliation + Swahili explanation
 *
 * Schema gap: `sic_events`, `shift_reconciliations` raw SQL.
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

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

export const DeviationCode = z.enum([
  'mechanical',
  'electrical',
  'operational',
  'weather',
  'blast',
  'fuel',
  'road',
  'blast_clearance',
  'change_of_operator',
  'supervision',
  'materials_shortage',
  'downstream_blocked',
  'accident',
  'no_clearance',
  'ground_instability',
  'water',
  'dust_control',
  'missing_supervisor',
  'missing_officer',
  'none',
]);

export const OperationsInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  shiftId: z.string().min(1),
  mode: z.enum(['pre_shift', 'ping', 'reconcile']),
  supervisor_id: z.string().min(1),
  payload: z.object({
    plan_target_tonnes: z.number().nonnegative().optional(),
    plan_machine_hours: z.number().nonnegative().optional(),
    actual_loads: z.number().int().nonnegative().optional(),
    actual_tonnes: z.number().nonnegative().optional(),
    actual_machine_hours: z.number().nonnegative().optional(),
    fuel_consumed_l: z.number().nonnegative().optional(),
    stoppages_minutes: z.number().nonnegative().optional(),
    free_text_swahili: z.string().optional(),
  }),
});
export type OperationsInput = z.infer<typeof OperationsInputSchema>;

export const OperationsOutput = AuditedOutputBase.extend({
  shift_id: z.string(),
  mode: z.enum(['pre_shift', 'ping', 'reconcile']),
  deviation_code: DeviationCode,
  variance_tonnes: z.number(),
  variance_pct: z.number(),
  explanation_swahili: z.string().min(1),
  explanation_english: z.string().min(1),
  root_cause_chain: z.array(z.string()),
  tomorrow_plan_draft: z
    .object({
      target_tonnes: z.number().nonnegative(),
      assignments: z.array(z.object({ asset_id: z.string(), face: z.string() })),
    })
    .nullable(),
  excavator_idle_alert: z.boolean(),
});
export type OperationsOutput = z.infer<typeof OperationsOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const OPERATIONS_SIC_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Operations / SIC Agent',
  mandate:
    'Run the SIC loop: deliver pre-shift plan, capture ping answers, reconcile end-of-shift, ' +
    'and explain deviations in plain Swahili first then English.',
  tools:
    'deliver_pre_shift, capture_sic_ping, reconcile_shift, explain_deviation, draft_tomorrow, excavator_idle_watch.',
  evidence:
    'Cite the SIC event_id when explaining a deviation. Reference the asset_id and the operator_id when ' +
    'attributing downtime. Cite the standard deviation code table.',
  outputSchema:
    '{ "shift_id": string, "mode": "pre_shift"|"ping"|"reconcile", "deviation_code": DeviationCode, ' +
    '"variance_tonnes": number, "variance_pct": number, "explanation_swahili": string, "explanation_english": string, ' +
    '"root_cause_chain": string[], "tomorrow_plan_draft": {...}|null, "excavator_idle_alert": boolean, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.65,
  autonomyDomain: 'shift coordination; never modifies payroll or signs off attendance autonomously',
  hardRules: [
    'Excavator-Never-Idle threshold default 10 min; flag if exceeded.',
    'Always produce Swahili-first explanation; English follows.',
    'If incident reported, ALSO escalate to safety-agent.',
  ],
});

function buildUserPrompt(input: OperationsInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  SHIFT: ${input.shiftId}`,
    `MODE: ${input.mode}  SUPERVISOR: ${input.supervisor_id}`,
    `PAYLOAD:`,
    JSON.stringify(input.payload, null, 2),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createOperationsSicAgent(deps: JuniorDeps) {
  return {
    async processInput(input: OperationsInput): Promise<OperationsOutput> {
      const validated = OperationsInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'operations-sic-agent',
        schema: OperationsOutput,
        systemPrompt: OPERATIONS_SIC_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2000,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const payloadJson = JSON.stringify(validated.payload);
          // TODO(phase-3): typed insert against `sic_events` + `shift_reconciliations`.
          await deps.db.execute(
            sql`INSERT INTO sic_events
                  (id, tenant_id, site_id, shift_id, mode, supervisor_id, deviation_code,
                   variance_tonnes, variance_pct, payload, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.siteId}, ${validated.shiftId},
                        ${validated.mode}, ${validated.supervisor_id}, ${output.deviation_code},
                        ${output.variance_tonnes}, ${output.variance_pct},
                        ${payloadJson}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('operations-sic-agent: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return output;
    },
  };
}
export type OperationsSicAgent = ReturnType<typeof createOperationsSicAgent>;

export function createDefaultOperationsSicAgent(): OperationsSicAgent {
  let cached: OperationsSicAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createOperationsSicAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
