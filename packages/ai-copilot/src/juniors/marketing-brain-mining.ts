/**
 * Marketing Brain (Mining) — investor-facing narrative composer.
 *
 * Mandate: draft one-pagers, board updates, and NEMC-submission narrative
 * for a Tanzanian mining tenant. Consumes the intelligence corpus, the
 * Sales / Off-take agent's pricing advice, and recent production records
 * to produce a single Markdown document targeted at one of four
 * audiences (investor, board, regulator, community).
 *
 * Distinct from the legacy estate `packages/marketing-brain` package:
 * this junior operates inside the mining-domain junior pool and follows
 * AGENT_PROMPT_LIBRARY §0 universal envelope. No public listing or
 * external publish — composition only. The owner approves before any
 * external send.
 *
 * Writes via typed `db.insert(generatedReports)` (migration 0011) when
 * the schema is reachable, otherwise the audit lives only in the
 * returned envelope.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  isoToday,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const MarketingBrainMiningAudience = z.enum([
  'investor',
  'board',
  'regulator',
  'community',
]);
export type MarketingBrainMiningAudience = z.infer<typeof MarketingBrainMiningAudience>;

export const MarketingBrainMiningInputSchema = z.object({
  tenantId: z.string().min(1),
  target_audience: MarketingBrainMiningAudience,
  topic: z.string().min(1),
  language: z.enum(['sw', 'en']).default('en'),
  corpus_evidence_ids: z.array(z.string().min(1)).default([]),
  sales_advice: z
    .object({
      reference_price_tzs: z.number().nonnegative().optional(),
      reference_price_usd: z.number().nonnegative().optional(),
      window: z.enum(['lbma', 'bot_gold_window', 'spot']).optional(),
      evidence_id: z.string().optional(),
    })
    .optional(),
  production_records: z
    .array(
      z.object({
        period_iso: z.string().regex(/^\d{4}-\d{2}$/),
        site_id: z.string().min(1),
        recoverable_units: z.number().nonnegative(),
        unit_label: z.string().min(1),
        evidence_id: z.string().min(1),
      }),
    )
    .default([]),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type MarketingBrainMiningInput = z.infer<typeof MarketingBrainMiningInputSchema>;

export const MarketingBrainMiningOutput = AuditedOutputBase.extend({
  title: z.string().min(1),
  body_md: z.string().min(1),
  target_audience: MarketingBrainMiningAudience,
  language: z.enum(['sw', 'en']),
  word_count: z.number().int().nonnegative(),
});
export type MarketingBrainMiningOutput = z.infer<typeof MarketingBrainMiningOutput>;

export const MARKETING_BRAIN_MINING_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Marketing Brain (Mining)',
  mandate:
    'Draft investor-facing, board-facing, regulator-facing, or community-facing mining content. ' +
    'Compose only — never publish, never quote forward-looking returns without an "indicative" disclaimer.',
  tools:
    'corpus.lookup, sales.reference_price, production.records_query, lmbm.read_portfolio.',
  evidence:
    'Every numeric claim MUST carry an evidence_id (corpus passage, production record, or sales-agent advice). ' +
    'No promotional hyperbole. Pricing context cites the BoT gold-window or LBMA reference window.',
  outputSchema:
    '{ "title": string, "body_md": string, "target_audience": "investor"|"board"|"regulator"|"community", ' +
    '"language": "sw"|"en", "word_count": int, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'composition only; never sends to external recipient without owner approval',
  hardRules: [
    'Investor and board audiences: include explicit "indicative" disclaimer on any forward-looking number.',
    'Regulator audience: structure as NEMC / Mining Commission submission with cited Act sections.',
    'Community audience: bilingual Swahili-first, plain language, no financial jargon.',
    'Never invent production figures or pricing context — cite or omit.',
  ],
});

function buildUserPrompt(input: MarketingBrainMiningInput): string {
  return [
    `TENANT: ${input.tenantId}  AUDIENCE: ${input.target_audience}  LANG: ${input.language}  TODAY: ${isoToday()}`,
    `TOPIC: ${input.topic}`,
    `CORPUS_EVIDENCE_IDS (${input.corpus_evidence_ids.length}):`,
    JSON.stringify(input.corpus_evidence_ids, null, 2).slice(0, 2_000),
    `SALES_ADVICE:`,
    JSON.stringify(input.sales_advice ?? null, null, 2).slice(0, 1_500),
    `PRODUCTION_RECORDS (${input.production_records.length}):`,
    JSON.stringify(input.production_records, null, 2).slice(0, 3_000),
    `CONTEXT_JSON:`,
    JSON.stringify(input.context, null, 2).slice(0, 2_000),
  ].join('\n');
}

export function createMarketingBrainMiningAgent(deps: JuniorDeps) {
  return {
    async processInput(input: MarketingBrainMiningInput): Promise<MarketingBrainMiningOutput> {
      const validated = MarketingBrainMiningInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'marketing-brain-mining',
        schema: MarketingBrainMiningOutput,
        systemPrompt: MARKETING_BRAIN_MINING_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 3000,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const generatedReports = schemas?.generatedReports as unknown;
          if (generatedReports) {
            await deps.db
              .insert(generatedReports)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                cadence: 'marketing_mining',
                audience: output.target_audience,
                language: output.language,
                title: output.title,
                wordCount: output.word_count,
                body: output.body_md,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('marketing-brain-mining: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return output;
    },
  };
}
export type MarketingBrainMiningAgent = ReturnType<typeof createMarketingBrainMiningAgent>;

export function createDefaultMarketingBrainMiningAgent(): MarketingBrainMiningAgent {
  let cached: MarketingBrainMiningAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createMarketingBrainMiningAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
