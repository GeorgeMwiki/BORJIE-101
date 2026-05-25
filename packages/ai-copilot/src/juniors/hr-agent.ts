/**
 * HR Agent — attendance, advances, org chart, productivity-by-phase
 * (AGENT_PROMPT_LIBRARY §11).
 *
 * Tanzania local-content (Mining (Local Content) Regulations 2018 +
 * GN 563/2025):
 *   - 100 % non-managerial Tanzanian.
 *   - 80 % senior-management Tanzanian.
 *
 * Schema gap: `hr_summaries` raw SQL; TODO(phase-3).
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

export const Phase = z.enum(['exploration', 'development', 'production', 'closure', 'rehabilitation']);

export const Employee = z.object({
  employee_id: z.string().min(1),
  full_name: z.string().min(1),
  nationality: z.string().length(2), // ISO-3166 alpha-2 (TZ, KE, ZA, ...)
  role: z.string().min(1),
  is_senior_management: z.boolean().default(false),
  site_id: z.string().optional(),
  phase: Phase.optional(),
  daily_rate_tzs: z.number().nonnegative().optional(),
  attendance_last_30d: z.number().int().min(0).max(31),
  advances_outstanding_tzs: z.number().nonnegative().default(0),
});

export const HrAgentInputSchema = z.object({
  tenantId: z.string().min(1),
  employees: z.array(Employee).min(1),
  reporting_month_iso: z.string().regex(/^\d{4}-\d{2}$/),
});
export type HrAgentInput = z.infer<typeof HrAgentInputSchema>;

export const HrAgentOutput = AuditedOutputBase.extend({
  reporting_month: z.string(),
  headcount_total: z.number().int().nonnegative(),
  productivity_by_phase: z.array(
    z.object({
      phase: Phase,
      headcount: z.number().int().nonnegative(),
      tonnes_per_worker_day: z.number().nonnegative(),
    }),
  ),
  local_content_check: z.object({
    non_managerial_tz_pct: z.number().min(0).max(100),
    senior_mgmt_tz_pct: z.number().min(0).max(100),
    compliant: z.boolean(),
    deviations: z.array(z.string()),
  }),
  attendance_outliers: z.array(z.object({ employee_id: z.string(), attendance_days: z.number() })),
  advances_summary: z.object({ total_tzs: z.number().nonnegative(), employees_with_advances: z.number().int().nonnegative() }),
  reassignment_suggestions: z.array(
    z.object({ employee_id: z.string(), from_site: z.string(), to_site: z.string(), reason: z.string() }),
  ),
});
export type HrAgentOutput = z.infer<typeof HrAgentOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const HR_AGENT_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'HR Agent',
  mandate:
    'Maintain the workforce picture: attendance, advances, productivity-by-phase, local-content compliance, and reassignment recommendations.',
  tools:
    'list_employees, assign, log_attendance, detect_idle, recommend_reassignment, payroll_reconciliation, local_content_check.',
  evidence:
    'Cite Mining (Local Content) Regulations 2018 § + GN 563/2025 for any compliance call. ' +
    'Productivity comparisons MUST be phase-adjusted (exploration vs production not comparable).',
  outputSchema:
    '{ "reporting_month": string, "headcount_total": int, "productivity_by_phase": [...], ' +
    '"local_content_check": {...}, "attendance_outliers": [...], "advances_summary": {...}, ' +
    '"reassignment_suggestions": [...], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'advisory; never deducts payroll without owner approval',
  hardRules: [
    'Always phase-adjust productivity comparisons.',
    'Flag any senior_mgmt_tz_pct < 80 or non_managerial_tz_pct < 100.',
    'Never approve advance > 50 % monthly pay without owner sign-off.',
  ],
});

function buildUserPrompt(input: HrAgentInput): string {
  return [
    `TENANT: ${input.tenantId}  MONTH: ${input.reporting_month_iso}`,
    `EMPLOYEES (${input.employees.length}):`,
    JSON.stringify(input.employees, null, 2).slice(0, 4_500),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createHrAgent(deps: JuniorDeps) {
  return {
    async processInput(input: HrAgentInput): Promise<HrAgentOutput> {
      const validated = HrAgentInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'hr-agent',
        schema: HrAgentOutput,
        systemPrompt: HR_AGENT_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const json = JSON.stringify(output);
          // TODO(phase-3): typed insert against `hr_summaries`.
          await deps.db.execute(
            sql`INSERT INTO hr_summaries
                  (id, tenant_id, reporting_month, summary, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.reporting_month_iso},
                        ${json}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('hr-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type HrAgent = ReturnType<typeof createHrAgent>;

export function createDefaultHrAgent(): HrAgent {
  let cached: HrAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createHrAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
