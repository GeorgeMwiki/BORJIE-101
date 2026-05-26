/**
 * Buyer KYC Agent — NIDA verification, TIN check, AML declaration
 * validation. Closes the loop on Sales / Off-take buyer onboarding.
 *
 * Schema gap: `buyer_kyc_records` raw SQL; TODO(#30).
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

export const BuyerKycInputSchema = z.object({
  tenantId: z.string().min(1),
  buyer_id: z.string().min(1),
  legal_name: z.string().min(1),
  buyer_type: z.enum(['individual', 'company', 'cooperative', 'parastatal']),
  nida_number: z.string().optional(),
  tin: z.string().optional(),
  brela_number: z.string().optional(),
  beneficial_owners: z
    .array(
      z.object({
        name: z.string(),
        nationality: z.string().length(2),
        equity_pct: z.number().min(0).max(100),
      }),
    )
    .default([]),
  aml_declaration: z
    .object({
      source_of_funds: z.string(),
      pep_status: z.boolean(),
      sanctions_screened: z.boolean(),
    })
    .optional(),
  uploaded_evidence_ids: z.array(z.string()).default([]),
});
export type BuyerKycInput = z.infer<typeof BuyerKycInputSchema>;

export const BuyerKycOutput = AuditedOutputBase.extend({
  buyer_id: z.string(),
  kyc_status: z.enum(['approved', 'rejected', 'pending_documents', 'manual_review']),
  nida_check: z.object({ attempted: z.boolean(), passed: z.boolean(), reason: z.string().optional() }),
  tin_check: z.object({ attempted: z.boolean(), passed: z.boolean(), reason: z.string().optional() }),
  brela_check: z.object({ attempted: z.boolean(), passed: z.boolean(), reason: z.string().optional() }),
  aml_flags: z.array(z.string()).default([]),
  required_documents: z.array(z.string()).default([]),
  oecd_due_diligence_band: z.enum(['low', 'medium', 'high']),
});
export type BuyerKycOutput = z.infer<typeof BuyerKycOutput>;

export const BUYER_KYC_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Buyer KYC Agent',
  mandate:
    'Verify a buyer against NIDA (individuals), TIN (TRA), BRELA (companies), beneficial-ownership chain, AML declaration; assign an OECD due-diligence band.',
  tools: 'nida_lookup, tin_lookup, brela_lookup, sanctions_screen, beneficial_ownership_chain.',
  evidence:
    'Cite the verification reference number for every external check. Cite the uploaded_evidence_id for each document inspected.',
  outputSchema:
    '{ "buyer_id": string, "kyc_status": "approved"|"rejected"|"pending_documents"|"manual_review", ' +
    '"nida_check": {...}, "tin_check": {...}, "brela_check": {...}, "aml_flags": string[], ' +
    '"required_documents": string[], "oecd_due_diligence_band": "low"|"medium"|"high", ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.8,
  autonomyDomain: 'verification + recommendation; never marks "approved" without all required checks passing',
  hardRules: [
    'Never approve a buyer with PEP or sanctions hits without owner sign-off.',
    'For cross-border deals require OECD Annex II + ICMM + IFC alignment statement.',
    'For 3T / Gold cross-border deals require ICGLR + Kimberley (for diamonds) certificates.',
    'Refuse to mark NIDA passed without actual NIDA reference.',
  ],
});

function buildUserPrompt(input: BuyerKycInput): string {
  return [
    `TENANT: ${input.tenantId}  BUYER: ${input.buyer_id}`,
    `LEGAL_NAME: ${input.legal_name}  TYPE: ${input.buyer_type}`,
    input.nida_number ? `NIDA: ${input.nida_number}` : '',
    input.tin ? `TIN: ${input.tin}` : '',
    input.brela_number ? `BRELA: ${input.brela_number}` : '',
    `BENEFICIAL OWNERS:`,
    JSON.stringify(input.beneficial_owners, null, 2),
    input.aml_declaration ? `AML: ${JSON.stringify(input.aml_declaration)}` : 'AML: not declared',
    `EVIDENCE: ${JSON.stringify(input.uploaded_evidence_ids)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function createBuyerKycAgent(deps: JuniorDeps) {
  return {
    async processInput(input: BuyerKycInput): Promise<BuyerKycOutput> {
      const validated = BuyerKycInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'buyer-kyc-agent',
        schema: BuyerKycOutput,
        systemPrompt: BUYER_KYC_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2000,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(#30): typed insert against `buyer_kyc_records`.
          await deps.db.execute(
            sql`INSERT INTO buyer_kyc_records
                  (id, tenant_id, buyer_id, kyc_status, oecd_band, summary, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.buyer_id},
                        ${output.kyc_status}, ${output.oecd_due_diligence_band},
                        ${summary}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('buyer-kyc-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type BuyerKycAgent = ReturnType<typeof createBuyerKycAgent>;

export function createDefaultBuyerKycAgent(): BuyerKycAgent {
  let cached: BuyerKycAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createBuyerKycAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
