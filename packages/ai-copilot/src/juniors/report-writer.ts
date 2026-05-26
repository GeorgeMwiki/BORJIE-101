/**
 * Report Writer Agent — daily / weekly / monthly / investor / bank /
 * board / audit reports (AGENT_PROMPT_LIBRARY §28).
 *
 * Templated. Each cadence drives a different word budget and audience.
 *
 * Writes via typed `db.insert(generatedReports)` (migration 0011).
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  deterministicId,
  isoToday,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const ReportCadence = z.enum([
  'daily_owner_brief',
  'weekly_strategy_memo',
  'monthly_mining_report',
  'site_daily',
  'investor_bank_pack',
  'board_pack',
  'audit_pack',
  'community_update',
]);
export type ReportCadence = z.infer<typeof ReportCadence>;

export const ReportWriterInputSchema = z.object({
  tenantId: z.string().min(1),
  cadence: ReportCadence,
  audience: z.string().min(1), // 'owner', 'site_supervisor', 'TIB', 'NMB', 'NBC', 'CRDB', 'off_taker', 'village', 'mining_commission', etc.
  language: z.enum(['sw', 'en']).default('en'),
  context: z.record(z.string(), z.unknown()).default({}),
  expires_in_hours: z.number().int().positive().optional(), // for audit_pack
});
export type ReportWriterInput = z.infer<typeof ReportWriterInputSchema>;

export const ReportWriterOutput = AuditedOutputBase.extend({
  cadence: ReportCadence,
  document_id: z.string().min(1),
  title: z.string().min(1),
  word_count: z.number().int().nonnegative(),
  language: z.enum(['sw', 'en']),
  body_markdown: z.string().min(1),
  cards: z
    .array(z.object({ heading: z.string(), value: z.string(), source_evidence_id: z.string() }))
    .default([]),
  signed_url: z.string().nullable(),
});
export type ReportWriterOutput = z.infer<typeof ReportWriterOutput>;

export const REPORT_WRITER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Report Writer Agent',
  mandate:
    'Produce the readable artefacts the owner uses to think and third-parties use to underwrite. Templated by cadence with strict word budgets.',
  tools:
    'daily_owner_brief, weekly_strategy_memo, monthly_report, investor_pack, board_pack, audit_pack, lmbm_card_query.',
  evidence:
    'Every number must cite its source evidence_id. Every chart must link back to LMBM nodes. No marketing language; just truth.',
  outputSchema:
    '{ "cadence": ReportCadence, "document_id": string, "title": string, "word_count": int, "language": "sw"|"en", ' +
    '"body_markdown": string, "cards": [{...}], "signed_url": string|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'composition only; never sends to external recipient without owner approval',
  hardRules: [
    'Daily Owner Brief < 500 words; 5 cards (yesterday / today / blockers / costs / risks).',
    'Weekly Strategy Memo < 1500 words.',
    'Audit Pack always watermarked + expiring URL.',
    'Community Update bilingual Swahili-first.',
  ],
});

function buildUserPrompt(input: ReportWriterInput): string {
  return [
    `TENANT: ${input.tenantId}  CADENCE: ${input.cadence}  AUDIENCE: ${input.audience}  LANG: ${input.language}  TODAY: ${isoToday()}`,
    input.expires_in_hours !== undefined ? `EXPIRES_IN_HOURS: ${input.expires_in_hours}` : '',
    `CONTEXT_JSON:`,
    JSON.stringify(input.context, null, 2).slice(0, 5_000),
  ]
    .filter(Boolean)
    .join('\n');
}

export function createReportWriter(deps: JuniorDeps) {
  return {
    async processInput(input: ReportWriterInput): Promise<ReportWriterOutput> {
      const validated = ReportWriterInputSchema.parse(input);
      const documentId = deterministicId('rep', validated.tenantId, validated.cadence, isoToday());

      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'report-writer',
        schema: ReportWriterOutput,
        systemPrompt: REPORT_WRITER_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated) + `\nPRE-ASSIGNED document_id: ${documentId}`,
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 4000,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const generatedReports = schemas?.generatedReports as unknown;
          if (generatedReports) {
            await deps.db
              .insert(generatedReports)
              .values({
                id: output.document_id,
                tenantId: validated.tenantId,
                cadence: validated.cadence,
                audience: validated.audience,
                language: output.language,
                title: output.title,
                wordCount: output.word_count,
                body: output.body_markdown,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('report-writer: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type ReportWriter = ReturnType<typeof createReportWriter>;

export function createDefaultReportWriter(): ReportWriter {
  let cached: ReportWriter | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createReportWriter(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
