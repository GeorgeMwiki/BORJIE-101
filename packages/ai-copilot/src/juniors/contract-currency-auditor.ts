/**
 * Contract-Currency Auditor — REMEDIATION mode (cliff passed):
 *   1. Scan tenant contracts.
 *   2. Flag USD-denominated domestic agreements.
 *   3. Draft backdated TZS-conversion addenda.
 *   4. Estimate TRA exposure for each affected contract.
 *
 * Runs on or after 27 March 2026 (GN 198/2025 cliff). Pre-cliff usage
 * routes to FX/Treasury Agent instead.
 *
 * Schema gap: `contract_remediation` raw SQL; TODO(phase-3).
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

export const ContractCurrencyAuditorInputSchema = z.object({
  tenantId: z.string().min(1),
  contracts: z
    .array(
      z.object({
        contract_id: z.string().min(1),
        counterparty_name: z.string(),
        counterparty_is_tz_resident: z.boolean(),
        signed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        currency: z.string().length(3),
        amount: z.number().nonnegative(),
        domestic: z.boolean(),
        cross_border: z.boolean(),
        evidence_id: z.string(),
      }),
    )
    .min(1),
  current_bot_rate_tzs_per_usd: z.number().positive(),
  current_tra_penalty_rate_pct: z.number().min(0).max(100).default(15),
});
export type ContractCurrencyAuditorInput = z.infer<typeof ContractCurrencyAuditorInputSchema>;

export const ContractCurrencyAuditorOutput = AuditedOutputBase.extend({
  cliff_already_passed: z.boolean(),
  total_contracts_scanned: z.number().int().nonnegative(),
  flagged_contracts: z.array(
    z.object({
      contract_id: z.string(),
      reason: z.string(),
      original_currency: z.string(),
      original_amount: z.number(),
      tzs_equivalent: z.number(),
      addendum_drafted: z.boolean(),
      addendum_evidence_id: z.string().nullable(),
      tra_exposure_tzs: z.number().nonnegative(),
    }),
  ),
  total_tra_exposure_tzs: z.number().nonnegative(),
  remediation_status: z.enum(['ok', 'in_progress', 'requires_owner_action']),
  next_actions: z.array(z.string()),
});
export type ContractCurrencyAuditorOutput = z.infer<typeof ContractCurrencyAuditorOutput>;

export const CONTRACT_CURRENCY_AUDITOR_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Contract-Currency Auditor (REMEDIATION mode)',
  mandate:
    'Scan tenant contracts post-27-March-2026. Flag USD-denominated domestic contracts (void under GN 198/2025), draft backdated TZS conversion addenda, and estimate TRA exposure.',
  tools: 'list_contracts, draft_tzs_addendum_backdated, estimate_tra_exposure, fingerprint_signature_flow.',
  evidence:
    'Cite GN 198/2025 §x for every flag. Cite BoT mid-rate timestamp + source for every TZS conversion. ' +
    'Cite the original contract evidence_id + drafted addendum evidence_id.',
  outputSchema:
    '{ "cliff_already_passed": boolean, "total_contracts_scanned": int, "flagged_contracts": [...], ' +
    '"total_tra_exposure_tzs": number, "remediation_status": "ok"|"in_progress"|"requires_owner_action", ' +
    '"next_actions": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'remediation drafting only; never executes payment or signs without owner + counterparty fingerprint',
  hardRules: [
    'Never quote a TZS-equivalent in an addendum without a citation to the BoT rate timestamp.',
    'Cross-border contracts are exempt from the cliff — flag domestic-only.',
    'If counterparty refuses signature, escalate to owner with options (renegotiate, terminate, Minister extension).',
    'Backdated addenda must reference the original effective date AND today’s BoT rate for conversion clarity.',
  ],
});

function buildUserPrompt(input: ContractCurrencyAuditorInput): string {
  const today = isoToday();
  return [
    `TENANT: ${input.tenantId}  TODAY: ${today}  CLIFF: 2026-03-27`,
    `BoT_RATE: ${input.current_bot_rate_tzs_per_usd} TZS/USD  TRA_PENALTY_RATE: ${input.current_tra_penalty_rate_pct} %`,
    `CONTRACTS (${input.contracts.length}):`,
    JSON.stringify(input.contracts, null, 2).slice(0, 4_500),
  ].join('\n');
}

export function createContractCurrencyAuditor(deps: JuniorDeps) {
  return {
    async processInput(input: ContractCurrencyAuditorInput): Promise<ContractCurrencyAuditorOutput> {
      const validated = ContractCurrencyAuditorInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'contract-currency-auditor',
        schema: ContractCurrencyAuditorOutput,
        systemPrompt: CONTRACT_CURRENCY_AUDITOR_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 3000,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(phase-3): typed insert against `contract_remediation`.
          await deps.db.execute(
            sql`INSERT INTO contract_remediation
                  (id, tenant_id, status, total_exposure_tzs, summary, computed_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${output.remediation_status},
                        ${output.total_tra_exposure_tzs}, ${summary}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('contract-currency-auditor: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type ContractCurrencyAuditor = ReturnType<typeof createContractCurrencyAuditor>;

export function createDefaultContractCurrencyAuditor(): ContractCurrencyAuditor {
  let cached: ContractCurrencyAuditor | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createContractCurrencyAuditor(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
