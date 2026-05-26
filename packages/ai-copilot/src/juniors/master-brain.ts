/**
 * Master Brain — top-level router for the Borjie junior pool.
 *
 * Given (mode, owner query, optional context), selects which juniors to
 * dispatch in which order. Sonnet-class model; Auditor always runs last.
 *
 * Schema gap: there is no `decision_log` Drizzle schema yet — raw SQL
 * write below. TODO(#30): add `decision_log` to
 * `packages/database/src/schemas/`.
 */

import { randomUUID } from 'node:crypto';
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

export const MasterBrainMode = z.enum([
  'daily_brief',
  'ask',
  'crisis',
  'remediation',
  'planning',
  'compliance',
  'sales',
]);
export type MasterBrainMode = z.infer<typeof MasterBrainMode>;

export const MasterBrainInputSchema = z.object({
  tenantId: z.string().min(1),
  mode: MasterBrainMode,
  query: z.string().min(1),
  language: z.enum(['sw', 'en', 'fr']).default('sw'),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type MasterBrainInput = z.infer<typeof MasterBrainInputSchema>;

const JUNIOR_NAMES = [
  'document-agent',
  'auditor-agent',
  'licence-agent',
  'drill-hole-logger',
  'lab-assay-agent',
  'geology-agent',
  'mine-planner',
  'operations-sic-agent',
  'hr-agent',
  'asset-fleet-agent',
  'maintenance-agent',
  'procurement-agent',
  'cost-engineer',
  'fx-treasury-agent',
  'sales-offtake-agent',
  'buyer-kyc-agent',
  'marketplace-stakeholder-agent',
  'compliance-agent',
  'safety-agent',
  'community-agent',
  'village-csr-agent',
  'contract-currency-auditor',
  'report-writer',
  'notifications-router',
  'metallurgy-agent',
  'forecast-modeler',
  'risk-modeler',
] as const;

export const JuniorName = z.enum(JUNIOR_NAMES);
export type JuniorName = z.infer<typeof JuniorName>;

export const MasterBrainOutputSchema = AuditedOutputBase.extend({
  dispatch_plan: z
    .array(
      z.object({
        junior: JuniorName,
        order: z.number().int().min(0),
        parallel_group: z.number().int().min(0).default(0),
        intent: z.string().min(1),
      }),
    )
    .min(1, 'Master Brain must dispatch at least one junior'),
  one_line_answer: z.string().min(1),
  blocking_questions: z.array(z.string()).default([]),
  language_used: z.enum(['sw', 'en', 'fr']),
});
export type MasterBrainOutput = z.infer<typeof MasterBrainOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const MASTER_BRAIN_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Master Brain Router',
  mandate:
    'Read the owner query + mode, then choose the minimal set of juniors required to answer correctly. ' +
    'Order them by dependency. Group parallelisable juniors. Auditor MUST always be in the dispatch_plan last.',
  tools:
    'dispatch_juniors(plan: DispatchPlan) — handled by the orchestrator; you only emit the plan. ' +
    'No direct DB writes from Master Brain.',
  evidence:
    'Every junior you dispatch must justify why with a one-sentence intent. ' +
    'If a query is ambiguous, dispatch nothing and return blocking_questions instead.',
  outputSchema:
    '{ "one_line_answer": string, "dispatch_plan": [{ "junior": JuniorName, "order": int, "parallel_group": int, "intent": string }], ' +
    '"blocking_questions": string[], "language_used": "sw"|"en"|"fr", "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.6,
  autonomyDomain: 'routing-only — never executes a binding action directly',
  hardRules: [
    'Always include `auditor-agent` as the highest-order step (it gates).',
    'If mode === "crisis", include `safety-agent` and `notifications-router` automatically.',
    'If mode === "remediation" and query mentions USD or 27-Mar-2026, include `contract-currency-auditor`.',
    'Refuse to dispatch anything for queries that violate the Hard Rules.',
  ],
});

function buildUserPrompt(input: MasterBrainInput): string {
  return [
    `TENANT: ${input.tenantId}`,
    `MODE: ${input.mode}`,
    `LANGUAGE: ${input.language}`,
    `CONTEXT_JSON: ${JSON.stringify(input.context).slice(0, 4_000)}`,
    `OWNER_QUERY:`,
    `"""`,
    input.query.slice(0, 4_000),
    `"""`,
    `Available juniors: ${JUNIOR_NAMES.join(', ')}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createMasterBrainAgent(deps: JuniorDeps) {
  return {
    async processInput(input: MasterBrainInput): Promise<MasterBrainOutput> {
      const validated = MasterBrainInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'master-brain',
        schema: MasterBrainOutputSchema,
        systemPrompt: MASTER_BRAIN_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 2000,
      });

      // Force-include the Auditor at the end if the model forgot.
      const hasAuditor = output.dispatch_plan.some((s) => s.junior === 'auditor-agent');
      const dispatch = hasAuditor
        ? output.dispatch_plan
        : [
            ...output.dispatch_plan,
            {
              junior: 'auditor-agent' as const,
              order: Math.max(...output.dispatch_plan.map((s) => s.order), 0) + 1,
              parallel_group: 0,
              intent: 'Gate the dispatch outputs before they reach the owner.',
            },
          ];

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const decisionLog = schemas?.decisionLog as unknown;
          if (decisionLog) {
            await deps.db
              .insert(decisionLog)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                mode: validated.mode,
                query: validated.query,
                dispatchPlan: dispatch,
                confidence: String(output.confidence),
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('master-brain: decision_log write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { ...output, dispatch_plan: dispatch };
    },
  };
}
export type MasterBrainAgent = ReturnType<typeof createMasterBrainAgent>;

export function createDefaultMasterBrainAgent(): MasterBrainAgent {
  let cached: MasterBrainAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createMasterBrainAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
