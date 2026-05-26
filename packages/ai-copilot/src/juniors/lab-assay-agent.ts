/**
 * Lab / Assay Agent — sample chain-of-custody, QA/QC, lab-report ingest.
 *
 * AGENT_PROMPT_LIBRARY §8:
 *   - Generate triplicate bag-and-tag manifest per batch.
 *   - Insert 5-10 % QA/QC samples: 1-in-20 CRM, 1-in-20 coarse blank,
 *     1-in-20 field duplicate.
 *   - Choose lab + technique per mineral (SGS / BV / ALS / Intertek / GST / AMGC).
 *   - Ingest results, compute QA/QC chart, FLAG failures.
 *
 * Schema gap: `sample_batches`, `qaqc_results`, `assay_results` are not
 * yet in Drizzle. Raw SQL writes; TODO(#30).
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

export const LabId = z.enum(['SGS_MWANZA', 'BV_GEITA', 'BV_MWANZA', 'ALS_MWANZA', 'INTERTEK_GEITA', 'GST_DODOMA', 'AMGC_DAR']);

export const SampleSchema = z.object({
  sample_id: z.string().min(1),
  hole_id: z.string().optional(),
  depth_from_m: z.number().nonnegative().optional(),
  depth_to_m: z.number().positive().optional(),
  mass_kg: z.number().positive(),
});
export type Sample = z.infer<typeof SampleSchema>;

export const LabAssayInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  batchId: z.string().min(1),
  mineral: z.string().min(1), // Au, Cu, Ag, REE, U, Sn, Diamond, etc.
  samples: z.array(SampleSchema).min(1),
  lab_preference: LabId.optional(),
  budget_constrained: z.boolean().default(false),
  result_csv_url: z.string().url().optional(),
});
export type LabAssayInput = z.infer<typeof LabAssayInputSchema>;

export const QaQcFailure = z.object({
  kind: z.enum(['CRM_out_of_range', 'blank_contaminated', 'duplicate_drift', 'sample_loss', 'tag_mismatch']),
  sample_id: z.string(),
  detail: z.string(),
});

export const LabAssayOutput = AuditedOutputBase.extend({
  batch_id: z.string().min(1),
  recommended_lab: LabId,
  recommended_technique: z.string().min(1),
  estimated_cost_tzs: z.number().nonnegative(),
  estimated_turnaround_days: z.number().int().positive(),
  manifest_with_qaqc: z.array(
    z.object({
      sample_id: z.string(),
      kind: z.enum(['field', 'CRM', 'blank', 'duplicate']),
      tag_codes: z.array(z.string()).length(3),
    }),
  ),
  qaqc_passed: z.boolean(),
  qaqc_failures: z.array(QaQcFailure).default([]),
});
export type LabAssayOutput = z.infer<typeof LabAssayOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const LAB_ASSAY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Lab / Assay Agent',
  mandate:
    'Build the bag-and-tag manifest with 5-10 % QA/QC inserts, recommend lab + technique by mineral, ' +
    'estimate cost + turnaround, and ingest result CSV/PDF when present.',
  tools:
    'generate_manifest(batch_id), insert_qaqc(batch_id, samples), list_labs(), estimate_cost_turnaround, ' +
    'dispatch_courier, ingest_results.',
  evidence:
    'Cite the per-mineral dossier for technique selection (fire assay 15-50 g for Au, ICP-MS for REE, ' +
    'delayed neutron for U). Cite SADCAS ISO/IEC 17025:2017 accreditation for GST recommendations.',
  outputSchema:
    '{ "batch_id": string, "recommended_lab": LabId, "recommended_technique": string, ' +
    '"estimated_cost_tzs": number, "estimated_turnaround_days": int, ' +
    '"manifest_with_qaqc": [{...}], "qaqc_passed": boolean, "qaqc_failures": QaQcFailure[], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'manifest + recommendation; ingestion of results is binding (writes assay_results)',
  hardRules: [
    'Never accept a result without the QA/QC pack passing.',
    'For high-grade gold (> 10 g/t) require gravimetric finish (AAS saturates).',
    'Never approve a "Mineral Resource Estimate" without a Competent Person sign-off.',
    'For diamond, recommend bulk DMS not assay.',
  ],
});

function buildUserPrompt(input: LabAssayInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  BATCH: ${input.batchId}`,
    `MINERAL: ${input.mineral}`,
    `SAMPLES (${input.samples.length}):`,
    JSON.stringify(input.samples, null, 2).slice(0, 3_000),
    input.lab_preference ? `LAB PREF: ${input.lab_preference}` : '',
    `BUDGET CONSTRAINED: ${input.budget_constrained}`,
    input.result_csv_url ? `RESULTS_CSV_URL: ${input.result_csv_url}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createLabAssayAgent(deps: JuniorDeps) {
  return {
    async processInput(input: LabAssayInput): Promise<LabAssayOutput> {
      const validated = LabAssayInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'lab-assay-agent',
        schema: LabAssayOutput,
        systemPrompt: LAB_ASSAY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const manifestJson = JSON.stringify(output.manifest_with_qaqc);
          const failuresJson = JSON.stringify(output.qaqc_failures);
          // TODO(#30): typed inserts against `sample_batches` + `qaqc_results`.
          await deps.db.execute(
            sql`INSERT INTO sample_batches
                  (id, tenant_id, site_id, batch_id, mineral, recommended_lab, technique,
                   cost_tzs, turnaround_days, manifest, qaqc_passed, qaqc_failures, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.siteId}, ${validated.batchId},
                        ${validated.mineral}, ${output.recommended_lab}, ${output.recommended_technique},
                        ${output.estimated_cost_tzs}, ${output.estimated_turnaround_days},
                        ${manifestJson}::jsonb, ${output.qaqc_passed}, ${failuresJson}::jsonb, NOW())
                ON CONFLICT (batch_id) DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('lab-assay-agent: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return output;
    },
  };
}
export type LabAssayAgent = ReturnType<typeof createLabAssayAgent>;

export function createDefaultLabAssayAgent(): LabAssayAgent {
  let cached: LabAssayAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createLabAssayAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
