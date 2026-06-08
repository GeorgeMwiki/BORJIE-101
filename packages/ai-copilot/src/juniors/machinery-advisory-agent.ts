/**
 * Machinery & Equipment Advisory Agent — the mining-estate chief-engineer
 * junior (one engine, five capability areas) grounded in
 * `Docs/research/mining-machinery-advisory.md`.
 *
 * ONE engine, mining-asset knowledge pack. The deterministic core lives
 * in `machinery-advisory-knowledge.ts` (pure, evidence-bearing); this
 * file:
 *   1. validates the request (zod) with a `mode` discriminator,
 *   2. runs the deterministic computation for that mode (the dossier
 *      facts that need no LLM — MTBF/MTTR, sizing formulas, breakeven,
 *      TCO ranking, failure-mode crib sheet),
 *   3. injects those facts into the brain PORT (never an SDK directly)
 *      for the reasoning/synthesis the numbers can't supply (diagnosis
 *      narrative, strategy justification, owner-facing recommendation),
 *   4. merges the deterministic evidence_ids into the LLM output so the
 *      Auditor always sees >=1 dossier-anchored evidence record, and
 *   5. persists a summary via typed `db.insert(juniorMaintenanceEvents)`.
 *
 * Capability areas (CAPABILITY_SPEC_WAVE3 §"Conversion Engine"): fault
 * diagnosis/troubleshooting; maintenance strategy (RCM/PdM, MTBF/MTTR,
 * ISO 14224); equipment selection/sizing; lease-vs-buy financial
 * analysis; procurement/TCO.
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
import {
  computeReliabilityKpis,
  failureModesFor,
  leaseVsBuy,
  matchLoaderToTruck,
  rankSuppliersByTco,
  selectMaintenanceStrategy,
  sizeFleet,
  sizeGenset,
  MMA_EVIDENCE,
  type AssetClass,
} from './machinery-advisory-knowledge.js';

// ─────────────────────────────────────────────────────────────────────
// Input schemas — discriminated by `mode`
// ─────────────────────────────────────────────────────────────────────

export const AssetClassEnum = z.enum([
  'haul_truck',
  'excavator',
  'loader',
  'dozer',
  'drill_rig',
  'crusher',
  'sag_mill',
  'ball_mill',
  'conveyor',
  'slurry_pump',
  'genset',
  'gold_room',
  'weighbridge',
]);

const BaseInput = z.object({
  tenantId: z.string().min(1),
  asset_id: z.string().min(1),
  asset_class: AssetClassEnum,
  /** ISO-4217 currency code for every money input/output. Never hard-coded. */
  currency: z.string().length(3).default('TZS'),
});

export const DiagnosisInput = BaseInput.extend({
  mode: z.literal('diagnosis'),
  symptoms: z.array(z.string().min(1)).default([]),
  reliability: z
    .object({
      operating_hours: z.number().nonnegative(),
      repair_downtime_hours: z.number().nonnegative(),
      failures: z.number().int().nonnegative(),
    })
    .optional(),
});

export const StrategyInput = BaseInput.extend({
  mode: z.literal('maintenance_strategy'),
  criticality: z.enum(['A', 'B', 'C']),
  degradation_measurable: z.boolean(),
  high_value_or_mobile: z.boolean(),
  reliability: z
    .object({
      operating_hours: z.number().nonnegative(),
      repair_downtime_hours: z.number().nonnegative(),
      failures: z.number().int().nonnegative(),
    })
    .optional(),
});

export const SelectionInput = BaseInput.extend({
  mode: z.literal('selection_sizing'),
  loader_truck: z
    .object({
      loader_dipper_yd3: z.number().nonnegative(),
      bucket_payload_t: z.number().nonnegative(),
      target_truck_payload_t: z.number().nonnegative(),
      observed_fill_factor: z.number().min(0).max(1),
    })
    .optional(),
  fleet: z
    .object({
      daily_tonnage_tpd: z.number().nonnegative(),
      loader_productivity_tph: z.number().nonnegative(),
      truck_productivity_tph: z.number().nonnegative(),
      working_hours_per_day: z.number().positive(),
    })
    .optional(),
  genset: z
    .object({
      expected_load_kw: z.number().nonnegative(),
      rating_kw: z.number().nonnegative(),
      duty: z.enum(['prime', 'standby']),
    })
    .optional(),
});

export const LeaseVsBuyInput = BaseInput.extend({
  mode: z.literal('lease_vs_buy'),
  finance: z.object({
    purchase_price: z.number().nonnegative(),
    economic_life_years: z.number().positive(),
    residual_value: z.number().nonnegative(),
    annual_owning_fixed_cost: z.number().nonnegative(),
    operating_cost_per_hour: z.number().nonnegative(),
    rental_rate_per_hour: z.number().nonnegative(),
    expected_hours_per_year: z.number().nonnegative(),
  }),
});

export const ProcurementInput = BaseInput.extend({
  mode: z.literal('procurement_tco'),
  bids: z
    .array(
      z.object({
        supplier_id: z.string().min(1),
        sticker_price: z.number().nonnegative(),
        est_lifetime_fuel_cost: z.number().nonnegative(),
        est_lifetime_parts_cost: z.number().nonnegative(),
        parts_lead_time_days: z.number().nonnegative(),
        warranty_months: z.number().nonnegative(),
        in_country_dealer: z.boolean(),
        local_content_pct: z.number().min(0).max(100),
      }),
    )
    .min(1),
});

export const MachineryAdvisoryInputSchema = z.discriminatedUnion('mode', [
  DiagnosisInput,
  StrategyInput,
  SelectionInput,
  LeaseVsBuyInput,
  ProcurementInput,
]);
export type MachineryAdvisoryInput = z.infer<typeof MachineryAdvisoryInputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Output schema — one shape across all modes (optional per-mode blocks)
// ─────────────────────────────────────────────────────────────────────

export const MachineryAdvisoryOutput = AuditedOutputBase.extend({
  asset_id: z.string(),
  mode: z.enum(['diagnosis', 'maintenance_strategy', 'selection_sizing', 'lease_vs_buy', 'procurement_tco']),
  currency: z.string().length(3),
  /** Free-text engineer narrative from the brain port. */
  summary: z.string().min(1),
  /** Owner-facing next actions (advisory only). */
  recommendations: z.array(z.string()).default([]),
  /** Deterministic facts surfaced to the owner, mode-dependent. */
  computed: z.record(z.string(), z.unknown()).default({}),
});
export type MachineryAdvisoryOutput = z.infer<typeof MachineryAdvisoryOutput>;

// ─────────────────────────────────────────────────────────────────────
// System prompt (AGENT_PROMPT_LIBRARY §0 universal envelope)
// ─────────────────────────────────────────────────────────────────────

export const MACHINERY_ADVISORY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Machinery & Equipment Advisory Agent',
  mandate:
    'Act as the mining-estate chief engineer / 20-year asset manager. Across one engine you handle five areas: ' +
    '(1) fault diagnosis & troubleshooting from symptoms + condition data; (2) maintenance strategy under RCM/PdM ' +
    'with ISO 14224 MTBF/MTTR/availability; (3) equipment selection & sizing; (4) lease-vs-buy with the WGC AISC ' +
    'treatment; (5) procurement on Total Cost of Ownership, never sticker price. A deterministic knowledge pack has ' +
    'already computed the hard numbers and candidate failure modes for you — reason ON TOP of them; do not recompute ' +
    'or contradict them. Produce an engineer narrative + owner-facing advisory recommendations.',
  tools:
    'compute_reliability_kpis (MTBF/MTTR/availability), select_maintenance_strategy (RCM 4-strategy), ' +
    'failure_modes_for(asset_class), match_loader_truck (9:1, t=9.0·S^1.1), size_fleet, size_genset, ' +
    'lease_vs_buy (utilisation breakeven + AISC), rank_suppliers_by_tco.',
  evidence:
    'Cite the mining-machinery-advisory dossier section ids supplied in COMPUTED_FACTS.evidence_ids (e.g. ' +
    'mma:§2.4 for MTBF/MTTR, mma:§3.1 for 9:1 match, mma:§4.5 for utilisation breakeven, mma:§5.1 for TCO). ' +
    'Every recommendation must trace to at least one such id; an empty evidence chain is rejected by the Auditor.',
  outputSchema:
    '{ "asset_id": string, "mode": string, "currency": string, "summary": string, "recommendations": string[], ' +
    '"computed": object, "confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain:
    'advisory only — never authorises a purchase, lease, parts order, or maintenance shutdown; ' +
    'procurement-agent + owner sign-off own the binding action.',
  hardRules: [
    'Never advise mercury-based recovery; the responsible ASM-to-mid-tier path is gravity-first, mercury-free.',
    'Never recommend running a SAG/ball mill without confirmed lube flow (trunnion-bearing wiping risk).',
    'Critical oil/vibration flag or wet-stacking risk -> recommend stop + inspection before continued running.',
    'Rank procurement on TCO + fuel + parts lead-time + warranty + in-country dealer + local content — never sticker price.',
    'For metallurgical-balance gaps, triage in order: weighbridge calibration -> GIC -> sampling/assay -> theft LAST.',
    'All money is in the request currency; never quote a USD figure for a domestic TZ transaction (GN 198/2025).',
  ],
});

// ─────────────────────────────────────────────────────────────────────
// Deterministic computation per mode (pure dispatch)
// ─────────────────────────────────────────────────────────────────────

interface ComputeResult {
  readonly computed: Record<string, unknown>;
  readonly evidenceIds: ReadonlyArray<string>;
}

function computeForMode(input: MachineryAdvisoryInput): ComputeResult {
  switch (input.mode) {
    case 'diagnosis':
      return computeDiagnosis(input);
    case 'maintenance_strategy':
      return computeStrategy(input);
    case 'selection_sizing':
      return computeSelection(input);
    case 'lease_vs_buy':
      return computeLeaseVsBuy(input);
    case 'procurement_tco':
      return computeProcurement(input);
    default:
      return exhaustive(input);
  }
}

function computeDiagnosis(input: z.infer<typeof DiagnosisInput>): ComputeResult {
  const modes = failureModesFor(input.asset_class as AssetClass);
  const evidence = new Set<string>([MMA_EVIDENCE.failureCrib, ...modes.map((m) => m.evidence_id)]);
  const computed: Record<string, unknown> = { candidate_failure_modes: modes };
  if (input.reliability) {
    const kpis = computeReliabilityKpis(input.reliability);
    computed.reliability_kpis = kpis;
    evidence.add(kpis.evidence_id);
  }
  return { computed, evidenceIds: [...evidence] };
}

function computeStrategy(input: z.infer<typeof StrategyInput>): ComputeResult {
  const verdict = selectMaintenanceStrategy({
    criticality: input.criticality,
    degradation_measurable: input.degradation_measurable,
    high_value_or_mobile: input.high_value_or_mobile,
  });
  const evidence = new Set<string>(verdict.evidence_ids);
  const computed: Record<string, unknown> = { strategy: verdict };
  if (input.reliability) {
    const kpis = computeReliabilityKpis(input.reliability);
    computed.reliability_kpis = kpis;
    evidence.add(kpis.evidence_id);
  }
  return { computed, evidenceIds: [...evidence] };
}

function computeSelection(input: z.infer<typeof SelectionInput>): ComputeResult {
  const evidence = new Set<string>();
  const computed: Record<string, unknown> = {};
  if (input.loader_truck) {
    const m = matchLoaderToTruck(input.loader_truck);
    computed.loader_truck_match = m;
    m.evidence_ids.forEach((e) => evidence.add(e));
  }
  if (input.fleet) {
    const f = sizeFleet(input.fleet);
    computed.fleet_sizing = f;
    f.evidence_ids.forEach((e) => evidence.add(e));
  }
  if (input.genset) {
    const g = sizeGenset(input.genset);
    computed.genset_sizing = g;
    g.evidence_ids.forEach((e) => evidence.add(e));
  }
  if (evidence.size === 0) evidence.add(MMA_EVIDENCE.openPitSizing);
  return { computed, evidenceIds: [...evidence] };
}

function computeLeaseVsBuy(input: z.infer<typeof LeaseVsBuyInput>): ComputeResult {
  const result = leaseVsBuy(input.finance);
  return { computed: { lease_vs_buy: result }, evidenceIds: [...result.evidence_ids] };
}

function computeProcurement(input: z.infer<typeof ProcurementInput>): ComputeResult {
  const ranking = rankSuppliersByTco(input.bids);
  return { computed: { procurement_ranking: ranking }, evidenceIds: [...ranking.evidence_ids] };
}

function exhaustive(x: never): never {
  throw new Error(`machinery-advisory-agent: unhandled mode ${JSON.stringify(x)}`);
}

// ─────────────────────────────────────────────────────────────────────
// User prompt — inject the deterministic facts into the brain port
// ─────────────────────────────────────────────────────────────────────

function buildUserPrompt(input: MachineryAdvisoryInput, compute: ComputeResult): string {
  return [
    `TENANT: ${input.tenantId}  ASSET: ${input.asset_id}  CLASS: ${input.asset_class}  MODE: ${input.mode}  CURRENCY: ${input.currency}`,
    'mode' in input && input.mode === 'diagnosis' && input.symptoms.length > 0
      ? `SYMPTOMS:\n${input.symptoms.map((s) => `- ${s}`).join('\n')}`
      : '',
    `COMPUTED_FACTS (deterministic — reason on top, do not recompute):`,
    JSON.stringify({ computed: compute.computed, evidence_ids: compute.evidenceIds }, null, 2).slice(0, 6_000),
    `Return STRICT JSON for the OUTPUT_SCHEMA. Echo asset_id="${input.asset_id}", mode="${input.mode}", ` +
      `currency="${input.currency}". Include COMPUTED_FACTS.evidence_ids in your evidence_ids.`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createMachineryAdvisoryAgent(deps: JuniorDeps) {
  return {
    async processInput(input: MachineryAdvisoryInput): Promise<MachineryAdvisoryOutput> {
      const validated = MachineryAdvisoryInputSchema.parse(input);
      const compute = computeForMode(validated);

      const llm = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'machinery-advisory-agent',
        schema: MachineryAdvisoryOutput,
        systemPrompt: MACHINERY_ADVISORY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated, compute),
        maxTokens: 3000,
      });

      // Merge the deterministic evidence + computed facts so the Auditor
      // always sees dossier-anchored provenance and the owner sees the
      // hard numbers verbatim (LLM may not echo them all).
      const output: MachineryAdvisoryOutput = {
        ...llm,
        asset_id: validated.asset_id,
        mode: validated.mode,
        currency: validated.currency,
        computed: { ...compute.computed, ...llm.computed },
        evidence_ids: dedupe([...compute.evidenceIds, ...llm.evidence_ids]),
      };

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const juniorMaintenanceEvents = schemas?.juniorMaintenanceEvents as unknown;
          if (juniorMaintenanceEvents) {
            await deps.db
              .insert(juniorMaintenanceEvents)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                assetId: validated.asset_id,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('machinery-advisory-agent: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return output;
    },
  };
}
export type MachineryAdvisoryAgent = ReturnType<typeof createMachineryAdvisoryAgent>;

export function createDefaultMachineryAdvisoryAgent(): MachineryAdvisoryAgent {
  let cached: MachineryAdvisoryAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createMachineryAdvisoryAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

function dedupe(xs: ReadonlyArray<string>): string[] {
  return [...new Set(xs)];
}
