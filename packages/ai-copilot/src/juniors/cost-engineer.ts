/**
 * Cost Engineer Agent — two capabilities behind one junior:
 *
 *   1. Mining unit economics — P&L, unit economics, break-even
 *      sensitivity, cash runway (AGENT_PROMPT_LIBRARY §15) via
 *      `processInput`.
 *   2. Quantity Surveying (QS) — `processQs` runs the deterministic RICS
 *      NRM1/NRM2 + post-contract money-machine engine (`qs-engine.ts`):
 *      NRM1 elemental cost plan, NRM2 first-principles rate build-up, IPC
 *      gross→net valuation, variation valuation, retention release,
 *      final-account reconciliation and Earned Value Management
 *      (CPI/SPI/EAC). Grounded in
 *      `Docs/research/construction-built-environment.md` §2, §5, §8.
 *
 * The QS numbers are AUTHORITATIVE and DETERMINISTIC — the LLM port only
 * narrates; it never invents a valuation. The agent OVERWRITES the
 * model's echoed identity + computed fields with the engine truth. Money
 * values carry an explicit `currency_code`; the junior never hard-codes
 * TZS/USD. Every certified IPC / variation / final-account settlement is
 * a money event that MUST flow through `LedgerService.post()` — this
 * junior produces the valuation and flags `posts_to_ledger`; the ledger
 * records it (never a direct write here).
 *
 * Writes via typed `db.insert(unitEconomicsSnapshots)` (migration 0011).
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
  buildUnitRate,
  buildCostPlan,
  valuateIpc,
  valuateVariation,
  retentionReleaseSchedule,
  reconcileFinalAccount,
  computeEvm,
  type BoqLine,
  type CostPlanInput as QsCostPlanInput,
  type IpcInput as QsIpcInput,
  type VariationInput as QsVariationInput,
  type FinalAccountInput as QsFinalAccountInput,
  type EvmInput as QsEvmInput,
} from './qs-engine.js';

export const CostBucket = z.object({
  actual_tzs: z.number().nonnegative(),
  forecast_tzs: z.number().nonnegative(),
  committed_tzs: z.number().nonnegative(),
  unpaid_tzs: z.number().nonnegative(),
  disputed_tzs: z.number().nonnegative(),
  hidden_tzs: z.number().nonnegative(),
  document_blocked_tzs: z.number().nonnegative(),
});

export const CostEngineerInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  mineral: z.string().min(1),
  period_iso: z.string().regex(/^\d{4}-\d{2}$/),
  tonnes_rom: z.number().nonnegative(),
  tonnes_milled: z.number().nonnegative(),
  metres_advanced: z.number().nonnegative(),
  bcm_overburden: z.number().nonnegative(),
  recoverable_units: z.number().nonnegative(), // g for Au, t for Cu, ct for diamond
  recoverable_unit_label: z.string(),
  costs: CostBucket,
  current_price_per_unit_tzs: z.number().positive(),
});
export type CostEngineerInput = z.infer<typeof CostEngineerInputSchema>;

export const CostEngineerOutput = AuditedOutputBase.extend({
  unit_economics: z.object({
    tzs_per_metre: z.number().nonnegative(),
    tzs_per_bcm: z.number().nonnegative(),
    tzs_per_tonne_rom: z.number().nonnegative(),
    tzs_per_tonne_milled: z.number().nonnegative(),
    tzs_per_recoverable_unit: z.number().nonnegative(),
  }),
  break_even: z.object({
    be_price_tzs: z.number().nonnegative(),
    be_grade_pct_or_g_t: z.number().nonnegative(),
    sensitivity: z.array(
      z.object({ delta_pct: z.number(), result_pct_change: z.number() }),
    ),
  }),
  cash_runway_days: z.object({ best: z.number(), base: z.number(), worst: z.number() }),
  forecast: z.object({ d7: z.number(), d30: z.number(), d90: z.number() }),
  by_product_credits_tzs: z.number().nonnegative().default(0),
  smelter_payable_pct: z.number().min(0).max(100).optional(),
});
export type CostEngineerOutput = z.infer<typeof CostEngineerOutput>;

export const COST_ENGINEER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Cost Engineer Agent',
  mandate:
    'Compute unit economics, break-even with sensitivity, cash-runway scenarios (best/base/worst), 7/30/90-day forecasts.',
  tools: 'unit_economics, break_even, burn_rate, cash_runway, funding_requirement, smelter_payable.',
  evidence:
    'Cite each cost bucket (actual/forecast/committed/unpaid/disputed/hidden/document-blocked) used in unit economics. ' +
    'Cite the per-mineral file for by-product credits and payable terms (Cu 96-97 %, Pb 95 %, Zn 85 %, Co 60-65 %).',
  outputSchema:
    '{ "unit_economics": {...}, "break_even": {...}, "cash_runway_days": {...}, "forecast": {...}, ' +
    '"by_product_credits_tzs": number, "smelter_payable_pct"?: number, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'computational + advisory; never moves money',
  hardRules: [
    'Always model by-product credits (Au-Ag in Cu, Co-Ni-PGE in Ni sulphide, REE in apatite).',
    'Always model penalty elements (As, Sb, Hg, F, Cl, U) for concentrate sales.',
    'Never report in USD for a domestic transaction (GN 198/2025).',
    'A 0.5 g/t grade variation moves break-even ~15 % for typical SME gold — surface the sensitivity.',
  ],
});

function buildUserPrompt(input: CostEngineerInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  MINERAL: ${input.mineral}  PERIOD: ${input.period_iso}`,
    `PRODUCTION: ROM=${input.tonnes_rom}t MILLED=${input.tonnes_milled}t METRES=${input.metres_advanced}m BCM=${input.bcm_overburden} RECOV=${input.recoverable_units} ${input.recoverable_unit_label}`,
    `PRICE: ${input.current_price_per_unit_tzs} TZS/${input.recoverable_unit_label}`,
    `COSTS:`,
    JSON.stringify(input.costs, null, 2),
  ].join('\n');
}

// ═════════════════════════════════════════════════════════════════════
// Quantity-Surveying capability (RIBA Stages 0-7 construction programme)
//
// `processQs` is a distinct entry point: it runs the deterministic
// `qs-engine.ts` math, then asks the LLM only for narration + the audit
// envelope, and OVERWRITES every deterministic field with the engine
// truth. Grounded in construction-built-environment.md §2/§5/§8.
// ═════════════════════════════════════════════════════════════════════

export const RibaStage = z.enum([
  'stage_0_strategic_definition',
  'stage_1_preparation_briefing',
  'stage_2_concept_design',
  'stage_3_spatial_coordination',
  'stage_4_technical_design',
  'stage_5_manufacturing_construction',
  'stage_6_handover',
  'stage_7_use',
]);
export type RibaStage = z.infer<typeof RibaStage>;

export const QsTask = z.enum(['cost_plan', 'ipc_valuation', 'variation', 'final_account', 'evm']);
export type QsTask = z.infer<typeof QsTask>;

/** A measured BOQ line — either a pre-built `rate` or a first-principles `rate_buildup`. */
const RateBuildupSchema = z.object({
  labour_all_in_rate: z.number().nonnegative(),
  labour_hours_per_unit: z.number().nonnegative(),
  material_cost_per_unit: z.number().nonnegative(),
  plant_cost_per_unit: z.number().nonnegative(),
  waste_fraction: z.number().min(0),
  ohp_fraction: z.number().min(0),
});

const MeasuredLineSchema = z
  .object({
    code: z.string().min(1),
    description: z.string().min(1),
    quantity: z.number().nonnegative(),
    unit: z.string().min(1),
    rate: z.number().nonnegative().optional(),
    rate_buildup: RateBuildupSchema.optional(),
  })
  .refine((l) => l.rate !== undefined || l.rate_buildup !== undefined, {
    message: 'each measured line needs a rate or a rate_buildup',
  });

const CostPlanPayload = z.object({
  measured_works: z.array(MeasuredLineSchema).min(1),
  preliminaries: z.number().nonnegative(),
  fees_fraction: z.number().min(0),
  risk_fraction: z.number().min(0),
  inflation_fraction: z.number().min(0),
});

const IpcPayload = z.object({
  work_done_to_date: z.number().nonnegative(),
  materials_on_site: z.number().nonnegative(),
  variations_to_date: z.number(),
  retention_fraction: z.number().min(0).max(1),
  retention_limit_fraction: z.number().min(0).max(1),
  contract_sum: z.number().nonnegative(),
  previously_certified: z.number(),
});

const VariationPayload = z.object({
  quantity: z.number(),
  rate: z.number().nonnegative().optional(),
  dayworks: z
    .object({
      labour: z.number().nonnegative(),
      plant: z.number().nonnegative(),
      materials: z.number().nonnegative(),
      percentage_addition: z.number().min(0),
    })
    .optional(),
  basis: z.enum(['boq_rate', 'pro_rata', 'fair_rate', 'dayworks']),
});

const FinalAccountPayload = z.object({
  original_contract_sum: z.number().nonnegative(),
  remeasured_adjustment: z.number(),
  total_variations: z.number(),
  settled_claims: z.number(),
  fluctuations: z.number(),
  total_certified_to_date: z.number(),
});

const EvmPayload = z.object({
  planned_value: z.number().nonnegative(),
  earned_value: z.number().nonnegative(),
  actual_cost: z.number().nonnegative(),
  budget_at_completion: z.number().nonnegative(),
});

export const QsInputSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  currency_code: z.string().min(3).max(3),
  riba_stage: RibaStage,
  task: QsTask,
  cost_plan: CostPlanPayload.optional(),
  ipc: IpcPayload.optional(),
  variation: VariationPayload.optional(),
  final_account: FinalAccountPayload.optional(),
  evm: EvmPayload.optional(),
});
export type QsInput = z.infer<typeof QsInputSchema>;

export const QsOutput = AuditedOutputBase.extend({
  project_id: z.string(),
  currency_code: z.string(),
  riba_stage: RibaStage,
  task: QsTask,
  /** Authoritative deterministic engine output for the requested task. */
  computed: z.record(z.string(), z.unknown()),
  /** True for money events (IPC / variation / final account) — routes via LedgerService.post(). */
  posts_to_ledger: z.boolean(),
  qs_commentary: z.string().min(1),
  /** Stage-gate discipline warning (dossier §1) when a money event is run on an early-stage design. */
  stage_gate_warning: z.string().nullable().default(null),
});
export type QsOutput = z.infer<typeof QsOutput>;

/** Money events that MUST route through LedgerService.post(). */
const LEDGER_TASKS: ReadonlySet<QsTask> = new Set<QsTask>(['ipc_valuation', 'variation', 'final_account']);

/** RIBA stages too early to be valuing/certifying construction money. */
const PRE_CONSTRUCTION_STAGES: ReadonlySet<RibaStage> = new Set<RibaStage>([
  'stage_0_strategic_definition',
  'stage_1_preparation_briefing',
  'stage_2_concept_design',
  'stage_3_spatial_coordination',
]);

export const QS_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Cost Engineer Agent (Quantity Surveyor)',
  mandate:
    'Act as a chartered Quantity Surveyor for the estate construction programme. The deterministic engine has ALREADY computed ' +
    'the NRM1 cost plan / NRM2 rate build-up / IPC valuation / variation / final account / EVM — narrate the COMPUTED figures, ' +
    'NEVER recompute or invent them. Flag stage-gate discipline (no Stage-4/5 money on a Stage-2 design) and the money path.',
  tools:
    'cost_plan(NRM1), rate_buildup(NRM2), interim_payment_certificate, value_variation, retention_release, final_account, earned_value(CPI/SPI/EAC).',
  evidence:
    'Cite the BOQ item codes, the contract form (FIDIC Red/Yellow/Silver, NEC4 A-F) and the valuation source documents. ' +
    'Cite construction-built-environment.md §2/§5/§8 for the measurement and valuation rules applied.',
  outputSchema:
    '{ "project_id": string, "currency_code": string, "riba_stage": RibaStage, "task": QsTask, "computed": {...}, ' +
    '"posts_to_ledger": boolean, "qs_commentary": string, "stage_gate_warning": string|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain:
    'computational + advisory; never moves money — every certified IPC/variation/final-account posts via LedgerService.post()',
  hardRules: [
    'Never recompute or override the COMPUTED QS figures — they are the verified source of truth.',
    'Price preliminaries separately from unit rates (NRM2) — never smear prelims into rates.',
    'A Class-5 / RIBA Stage 0-2 estimate is never a commitment; warn when a money event runs on an early-stage design.',
    'Never let a certified IPC/variation/final-account bypass LedgerService.post() — produce the valuation, the ledger records it.',
    'Never report a domestic transaction in USD (GN 198/2025) — carry the explicit currency_code.',
  ],
});

/** Map a measured-line payload to a `qs-engine` BoqLine, building the rate from first principles when needed. */
function toBoqLine(line: z.infer<typeof MeasuredLineSchema>): BoqLine {
  const rate = line.rate ?? buildUnitRate(line.rate_buildup!).unit_rate;
  return { code: line.code, description: line.description, quantity: line.quantity, unit: line.unit, rate };
}

/**
 * Pure dispatch to the deterministic QS engine. Throws a typed
 * `"<task> payload required"` error when the matching payload is absent.
 */
export function runQsTask(input: QsInput): Record<string, unknown> {
  switch (input.task) {
    case 'cost_plan': {
      if (!input.cost_plan) throw new Error('cost_plan payload required');
      const engineInput: QsCostPlanInput = {
        measured_works: input.cost_plan.measured_works.map(toBoqLine),
        preliminaries: input.cost_plan.preliminaries,
        fees_fraction: input.cost_plan.fees_fraction,
        risk_fraction: input.cost_plan.risk_fraction,
        inflation_fraction: input.cost_plan.inflation_fraction,
      };
      return { cost_plan: buildCostPlan(engineInput) };
    }
    case 'ipc_valuation': {
      if (!input.ipc) throw new Error('ipc_valuation payload required');
      const ipc = valuateIpc(input.ipc as QsIpcInput);
      return { ipc, retention_release: retentionReleaseSchedule(ipc.retention_held) };
    }
    case 'variation': {
      if (!input.variation) throw new Error('variation payload required');
      return { variation: valuateVariation(input.variation as QsVariationInput) };
    }
    case 'final_account': {
      if (!input.final_account) throw new Error('final_account payload required');
      return { final_account: reconcileFinalAccount(input.final_account as QsFinalAccountInput) };
    }
    case 'evm': {
      if (!input.evm) throw new Error('evm payload required');
      return { evm: computeEvm(input.evm as QsEvmInput) };
    }
    default: {
      const exhaustive: never = input.task;
      throw new Error(`unknown QS task: ${String(exhaustive)}`);
    }
  }
}

function buildQsUserPrompt(input: QsInput, computed: Record<string, unknown>): string {
  return [
    `TENANT: ${input.tenantId}  PROJECT: ${input.projectId}  CURRENCY: ${input.currency_code}`,
    `RIBA_STAGE: ${input.riba_stage}  QS_TASK: ${input.task}`,
    `COMPUTED (verified deterministic engine output — narrate, do not alter):`,
    JSON.stringify(computed, null, 2).slice(0, 4_000),
  ].join('\n');
}

export function createCostEngineerAgent(deps: JuniorDeps) {
  return {
    async processInput(input: CostEngineerInput): Promise<CostEngineerOutput> {
      const validated = CostEngineerInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'cost-engineer',
        schema: CostEngineerOutput,
        systemPrompt: COST_ENGINEER_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 3000,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const unitEconomicsSnapshots = schemas?.unitEconomicsSnapshots as unknown;
          if (unitEconomicsSnapshots) {
            await deps.db
              .insert(unitEconomicsSnapshots)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                siteId: validated.siteId,
                period: validated.period_iso,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('cost-engineer: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },

    /**
     * Quantity-Surveying entry point. Runs the deterministic `qs-engine`
     * for the requested task, then asks the LLM only for narration; the
     * deterministic engine output + identity + ledger flag OVERWRITE the
     * model echo. The LLM can never fabricate a valuation.
     */
    async processQs(input: QsInput): Promise<QsOutput> {
      const validated = QsInputSchema.parse(input);
      // Deterministic engine FIRST — also surfaces a typed "<task> payload
      // required" error before any LLM cost is incurred.
      const computed = runQsTask(validated);

      const narrated = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'cost-engineer-qs',
        schema: QsOutput,
        systemPrompt: QS_SYSTEM_PROMPT,
        userPrompt: buildQsUserPrompt(validated, computed),
        maxTokens: 2000,
      });

      const posts_to_ledger = LEDGER_TASKS.has(validated.task);
      const stage_gate_warning =
        posts_to_ledger && PRE_CONSTRUCTION_STAGES.has(validated.riba_stage)
          ? `Stage-gate breach: a ${validated.task} money event is being run at ${validated.riba_stage} — certify only on construction-ready (Stage 4+) information.`
          : null;

      // Deterministic authority overwrites every model-echoed field.
      const output: QsOutput = {
        ...narrated,
        project_id: validated.projectId,
        currency_code: validated.currency_code,
        riba_stage: validated.riba_stage,
        task: validated.task,
        computed,
        posts_to_ledger,
        stage_gate_warning,
      };

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const unitEconomicsSnapshots = schemas?.unitEconomicsSnapshots as unknown;
          if (unitEconomicsSnapshots) {
            await deps.db
              .insert(unitEconomicsSnapshots)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                siteId: validated.projectId,
                period: validated.task,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('cost-engineer-qs: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return output;
    },
  };
}
export type CostEngineerAgent = ReturnType<typeof createCostEngineerAgent>;

export function createDefaultCostEngineerAgent(): CostEngineerAgent {
  let cached: CostEngineerAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createCostEngineerAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
    async processQs(input) {
      return (await get()).processQs(input);
    },
  };
}
