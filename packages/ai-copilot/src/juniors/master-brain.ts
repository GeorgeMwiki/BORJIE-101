/**
 * Master Brain — top-level router for the Borjie junior pool.
 *
 * Given (mode, owner query, optional context), selects which juniors to
 * dispatch in which order. Sonnet-class model; Auditor always runs last.
 *
 * Writes via typed `db.insert(decisionLog)` (migration 0011).
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
import { resolveTierModelId } from '../model-resolution.js';

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

/**
 * A retrieved corpus passage to GROUND the answer in. `text` MUST already
 * be PII-tokenised by the caller — `@borjie/ai-copilot` performs no LLM
 * egress control itself; the api-gateway orchestrator tokenises every
 * chunk via `@borjie/document-ai` before handing it here.
 */
export const RetrievedContextChunkSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
});
export type RetrievedContextChunk = z.infer<typeof RetrievedContextChunkSchema>;

export const MasterBrainInputSchema = z.object({
  tenantId: z.string().min(1),
  mode: MasterBrainMode,
  query: z.string().min(1),
  language: z.enum(['sw', 'en', 'fr']).default('sw'),
  context: z.record(z.string(), z.unknown()).default({}),
  /**
   * Top-K retrieved passages (already PII-tokenised). When present they
   * are injected as a "Retrieved context" block so the answer is grounded
   * in the corpus and can cite the chunk ids. Empty ⇒ un-grounded path.
   */
  retrievedContext: z.array(RetrievedContextChunkSchema).default([]),
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
  'marketing-brain-mining',
  'tutoring-skill-pack-mining',
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

/**
 * Render the shared "Retrieved context" block injected into both the
 * Master Brain and the junior synthesizer prompts. Returns `''` when there
 * are no chunks so the un-grounded prompt is byte-identical to before. The
 * passages are already PII-tokenised by the caller. A per-chunk char cap +
 * an overall budget bound the injected size (token-budget guard).
 */
export function formatRetrievedContextBlock(
  chunks: ReadonlyArray<RetrievedContextChunk>,
  opts?: { readonly perChunkChars?: number; readonly totalChars?: number },
): string {
  if (chunks.length === 0) return '';
  const perChunkChars = opts?.perChunkChars ?? 1_200;
  const totalChars = opts?.totalChars ?? 6_000;
  const lines: string[] = [
    'RETRIEVED_CONTEXT (ground your answer in these passages and cite their [id]; do NOT invent facts beyond them):',
  ];
  let used = 0;
  for (const chunk of chunks) {
    const body = chunk.text.replace(/\s+/g, ' ').trim().slice(0, perChunkChars);
    if (body.length === 0) continue;
    const entry = `[${chunk.id}] ${body}`;
    if (used + entry.length > totalChars) break;
    used += entry.length;
    lines.push(entry);
  }
  // Only the header was added (every chunk was empty) ⇒ emit nothing.
  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * Render the INTERNAL lens-blend steering block. The chat orchestrator
 * classifies the owner message into 1..N persona lenses (the owner never
 * picks a mode) and injects them via `context.activeLenses` +
 * `context.lensDirective`. Surfacing them as a dedicated prompt line — not
 * just buried in CONTEXT_JSON — makes the brain actually reason through the
 * blend when selecting juniors. No lenses ⇒ `''` (prompt byte-identical to
 * the un-lensed path, so legacy callers are unaffected).
 */
export function formatActiveLensBlock(
  context: Readonly<Record<string, unknown>>,
): string {
  const lenses = context['activeLenses'];
  const directive = context['lensDirective'];
  if (!Array.isArray(lenses) || lenses.length === 0) return '';
  if (typeof directive !== 'string' || directive.trim().length === 0) return '';
  return `ACTIVE_LENSES (${lenses.join(', ')}):\n${directive}`;
}

export function buildMasterBrainUserPrompt(input: MasterBrainInput): string {
  const retrieved = formatRetrievedContextBlock(input.retrievedContext);
  const lensBlock = formatActiveLensBlock(input.context);
  return [
    `TENANT: ${input.tenantId}`,
    `MODE: ${input.mode}`,
    `LANGUAGE: ${input.language}`,
    ...(lensBlock ? [lensBlock] : []),
    `CONTEXT_JSON: ${JSON.stringify(input.context).slice(0, 4_000)}`,
    ...(retrieved ? [retrieved] : []),
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
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        juniorName: 'master-brain',
        schema: MasterBrainOutputSchema,
        systemPrompt: MASTER_BRAIN_SYSTEM_PROMPT,
        userPrompt: buildMasterBrainUserPrompt(validated),
        model: resolveTierModelId('deep'),
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
