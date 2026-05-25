/**
 * Licence Agent — own the mineral-rights portfolio.
 *
 * Capabilities (AGENT_PROMPT_LIBRARY §2):
 *   - Renewal calendar with T-90 / T-30 / T-7 milestones per licence.
 *   - Dormancy score (0-100): last_payment_age × last_report_age ×
 *     work-programme variance × area utilisation × EPP filed.
 *   - Payment-history pack: GePG control numbers + Tumemadini receipts.
 *
 * Schema gap: `licences`, `licence_payments`, `licence_obligations` are
 * defined in DATA_MODEL.md §3.1 but the Drizzle schemas do not exist
 * yet. Raw SQL writes; TODO(phase-3) swap to typed drizzle inserts.
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  isoToday,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

export const LicenceKindSchema = z.enum(['PML', 'PL', 'ML', 'SML', 'DEALER', 'BROKER', 'PROCESSING']);
export type LicenceKind = z.infer<typeof LicenceKindSchema>;

export const LicenceAgentInputSchema = z.object({
  tenantId: z.string().min(1),
  licenceId: z.string().min(1),
  licenceNo: z.string().min(1),
  kind: LicenceKindSchema,
  grantDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  lastWorkProgrammeReportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  eppFiledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  areaUtilisationPct: z.number().min(0).max(100),
});
export type LicenceAgentInput = z.infer<typeof LicenceAgentInputSchema>;

export const RenewalMilestone = z.object({
  label: z.enum(['T-90', 'T-30', 'T-7', 'expiry']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['upcoming', 'due', 'overdue', 'complete']),
  required_actions: z.array(z.string()),
});
export type RenewalMilestone = z.infer<typeof RenewalMilestone>;

export const LicenceRenewalOutput = AuditedOutputBase.extend({
  licence_id: z.string().min(1),
  renewal_calendar: z.array(RenewalMilestone).min(1),
  dormancy_score: z.number().int().min(0).max(100),
  dormancy_factors: z.object({
    last_payment_age_days: z.number().int().min(0),
    last_report_age_days: z.number().int().min(0),
    work_programme_variance_pct: z.number(),
    area_utilisation_pct: z.number(),
    epp_filed: z.boolean(),
  }),
  payment_history_pack: z.array(
    z.object({
      gepg_control_no: z.string().min(1),
      paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amount_tzs: z.number().nonnegative(),
      kind: z.string(),
      receipt_evidence_id: z.string(),
    }),
  ),
  dormancy_alert_level: z.enum(['green', 'amber', 'red']),
});
export type LicenceRenewalOutput = z.infer<typeof LicenceRenewalOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const LICENCE_AGENT_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Licence Agent',
  mandate:
    'Maintain the renewal calendar (T-90 / T-30 / T-7 milestones), compute a 0-100 dormancy score, ' +
    'and assemble the payment-history pack for any licence the tenant holds.',
  tools:
    'list_licences(tenant_id), compute_dormancy_score(licence_id), schedule_renewal_pack(licence_id, due), ' +
    'cadastre_overlap_check(polygon), generate_gepg_control_number(kind, amount_tzs), citation_lookup(rule).',
  evidence:
    'Every milestone must cite the Mining Act section or the Tumemadini circular that creates the deadline. ' +
    'Payment-history pack entries must reference the GePG control number AND the receipt evidence_id.',
  outputSchema:
    '{ "licence_id": string, "renewal_calendar": RenewalMilestone[], "dormancy_score": int(0..100), ' +
    '"dormancy_factors": {...}, "payment_history_pack": [...], "dormancy_alert_level": "green"|"amber"|"red", ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.8,
  autonomyDomain: 'advisory + scheduling — never files renewals automatically',
  hardRules: [
    'Never quote a royalty rate from memory — always cite research/01 §3 or the Gazette.',
    'Never approve PML transfer to a non-citizen.',
    'Mining Commission dormancy revocation response must be assembled within 24 hours; flag if T-7 is past.',
    'All payments must go through GePG control numbers against tumemadini.go.tz portal.',
  ],
});

function buildUserPrompt(input: LicenceAgentInput): string {
  return [
    `TENANT: ${input.tenantId}`,
    `LICENCE: ${input.licenceNo} (${input.kind}) — id ${input.licenceId}`,
    `GRANT: ${input.grantDate}  EXPIRY: ${input.expiryDate}  TODAY: ${isoToday()}`,
    `LAST PAYMENT: ${input.lastPaymentDate ?? 'never'}  LAST WP REPORT: ${input.lastWorkProgrammeReportDate ?? 'never'}`,
    `EPP FILED AT: ${input.eppFiledAt ?? 'not yet'}`,
    `AREA UTILISATION: ${input.areaUtilisationPct.toFixed(1)} %`,
    `Compute the renewal calendar, dormancy score (with factors), and payment-history pack stub.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createLicenceAgent(deps: JuniorDeps) {
  return {
    async processInput(input: LicenceAgentInput): Promise<LicenceRenewalOutput> {
      const validated = LicenceAgentInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'licence-agent',
        schema: LicenceRenewalOutput,
        systemPrompt: LICENCE_AGENT_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const factorsJson = JSON.stringify(output.dormancy_factors);
          // TODO(phase-3): typed insert against `licence_dormancy_scores`.
          await deps.db.execute(
            sql`INSERT INTO licence_dormancy_scores
                  (id, tenant_id, licence_id, score, alert_level, factors, computed_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.licenceId},
                        ${output.dormancy_score}, ${output.dormancy_alert_level},
                        ${factorsJson}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('licence-agent: dormancy write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return output;
    },
  };
}
export type LicenceAgent = ReturnType<typeof createLicenceAgent>;

export function createDefaultLicenceAgent(): LicenceAgent {
  let cached: LicenceAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createLicenceAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
