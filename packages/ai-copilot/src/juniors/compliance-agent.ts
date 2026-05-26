/**
 * Compliance Agent — regulator citation library lookup, action
 * checklist generation (AGENT_PROMPT_LIBRARY §21).
 *
 * Schema gap: `compliance_verdicts` raw SQL; TODO(#30).
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

export const RegulatorBody = z.enum([
  'Tumemadini',
  'NEMC',
  'BoT',
  'TRA',
  'GePG',
  'OSHA',
  'BRELA',
  'NIDA',
  'LGA',
  'Minister_Lands',
  'Minister_Minerals',
  'TARURA',
  'TANROADS',
  'TBS',
]);

export const ProposedAction = z.object({
  action_kind: z.string().min(1),
  description: z.string().min(1),
  amount_tzs: z.number().nonnegative().optional(),
  cross_border: z.boolean().default(false),
  involves_mercury: z.boolean().default(false),
  involves_explosives: z.boolean().default(false),
  involves_water_within_60m: z.boolean().default(false),
  near_protected_area: z.boolean().default(false),
});

export const ComplianceInputSchema = z.object({
  tenantId: z.string().min(1),
  action: ProposedAction,
  context: z.record(z.string(), z.unknown()).default({}),
});
export type ComplianceInput = z.infer<typeof ComplianceInputSchema>;

export const Citation = z.object({
  rule_key: z.string().min(1),
  passage: z.string().min(1),
  source_url: z.string().optional(),
  gazette_number: z.string().optional(),
  date: z.string().optional(),
});

export const ComplianceOutput = AuditedOutputBase.extend({
  compliant: z.boolean(),
  blocking_regulators: z.array(RegulatorBody).default([]),
  citations: z.array(Citation).min(1, 'must cite at least one rule'),
  required_actions: z.array(
    z.object({ action: z.string(), regulator: RegulatorBody, due: z.string().optional() }),
  ),
  cross_border_alignment: z
    .object({ oecd_annex_ii: z.boolean(), icmm_ccm: z.boolean(), ifc_mining_ehs: z.boolean() })
    .optional(),
});
export type ComplianceOutput = z.infer<typeof ComplianceOutput>;

export const COMPLIANCE_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Compliance Agent',
  mandate:
    'Cross-check the proposed action against Mining Act 2010, EMA 2004, Land Act 1999, Village Land Act 1999, BoT GN 198/2025, CSR Reg 2023, Local Content Reg 2018 + GN 563/2025, OSHA 2003, Explosives Cap.45, OECD Due Diligence (3T+Gold), ICMM CCM, IFC Mining EHS.',
  tools: 'check_action, citation_lookup, ingest_gazette, list_regulator_updates.',
  evidence:
    'Every citation MUST include the specific Act § or the Gazette number + date. Cross-border calls MUST carry the OECD Annex II + ICMM + IFC alignment statement.',
  outputSchema:
    '{ "compliant": boolean, "blocking_regulators": RegulatorBody[], "citations": Citation[], ' +
    '"required_actions": [...], "cross_border_alignment"?: {...}, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'verdict only; never executes filings',
  hardRules: [
    'Block any action within 60 m of a water source (NAWAPO 2002).',
    'Block any mercury operational advice that increases exposure (Minamata).',
    'Block PML transfer to a non-citizen.',
    'Block USD pricing on domestic TZ transactions (GN 198/2025).',
  ],
  extras:
    'NOTE: the `citations` field uses the structured Citation schema above; the base envelope `citations` ' +
    'is a string[] — Auditor will accept either as long as both reference the same regulator.',
});

function buildUserPrompt(input: ComplianceInput): string {
  return [
    `TENANT: ${input.tenantId}`,
    `PROPOSED_ACTION:`,
    JSON.stringify(input.action, null, 2),
    `CONTEXT:`,
    JSON.stringify(input.context, null, 2).slice(0, 3_000),
  ].join('\n');
}

export function createComplianceAgent(deps: JuniorDeps) {
  return {
    async processInput(input: ComplianceInput): Promise<ComplianceOutput> {
      const validated = ComplianceInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'compliance-agent',
        schema: ComplianceOutput,
        systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(#30): typed insert against `compliance_verdicts`.
          await deps.db.execute(
            sql`INSERT INTO compliance_verdicts
                  (id, tenant_id, action_kind, compliant, summary, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.action.action_kind},
                        ${output.compliant}, ${summary}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('compliance-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type ComplianceAgent = ReturnType<typeof createComplianceAgent>;

export function createDefaultComplianceAgent(): ComplianceAgent {
  let cached: ComplianceAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createComplianceAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
