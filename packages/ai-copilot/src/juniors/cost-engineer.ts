/**
 * Cost Engineer Agent — TWO capabilities:
 *
 *   1. Mining unit economics — P&L, unit economics, break-even sensitivity
 *      (AGENT_PROMPT_LIBRARY §15). `processInput`.
 *
 *   2. Quantity-Surveying — a real QS junior for the estate's construction
 *      programme (mine camps/plants/civils + buildings) grounded in
 *      `Docs/research/construction-built-environment.md` §2/§5/§8:
 *      NRM2 first-principles rate build-up + NRM1 elemental cost plan,
 *      the §5 post-contract money machine (IPC valuation, variations,
 *      retention, final account), and §8.1 Earned Value Management.
 *      `processQs`. Deterministic math lives in `qs-engine.ts`; the LLM
 *      port narrates over verified numbers and never invents them.
 *
 * Money-path discipline: this junior PRODUCES IPC / variation / retention /
 * final-account valuations; it NEVER posts. Every certified money event
 * flows through `LedgerService.post()` (CLAUDE.md hard rule). All amounts
 * are currency-agnostic numbers carried with an explicit `currency_code`
 * (never hard-code TZS/USD); rendering uses `formatCurrency`.
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
  buildCostPlan,
  buildUnitRate,
  computeEvm,
  reconcileFinalAccount,
  retentionReleaseSchedule,
  valuateIpc,
  valuateVariation,
  type BoqLine,
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

// ─────────────────────────────────────────────────────────────────────
// QS capability — schemas (construction dossier §2/§5/§8)
// ─────────────────────────────────────────────────────────────────────

const RibaStage = z.enum([
  'stage_0_strategic_definition',
  'stage_1_preparation_briefing',
  'stage_2_concept_design',
  'stage_3_spatial_coordination',
  'stage_4_technical_design',
  'stage_5_manufacturing_construction',
  'stage_6_handover',
  'stage_7_use',
]);

const QsBoqLine = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1),
  /** Optional explicit rate; when absent, `rate_buildup` is required. */
  rate: z.number().nonnegative().optional(),
  /** NRM2 §2.2 first-principles build-up — used when `rate` is absent. */
  rate_buildup: z
    .object({
      labour_all_in_rate: z.number().nonnegative(),
      labour_hours_per_unit: z.number().nonnegative(),
      material_cost_per_unit: z.number().nonnegative(),
      plant_cost_per_unit: z.number().nonnegative(),
      waste_fraction: z.number().min(0).max(1),
      ohp_fraction: z.number().min(0).max(1),
    })
    .optional(),
});

const QsDayworks = z
  .object({
    labour: z.number().nonnegative(),
    plant: z.number().nonnegative(),
    materials: z.number().nonnegative(),
    percentage_addition: z.number().min(0).max(2),
  })
  .optional();

/** A plural-register variation row (carries its own `ref`). */
const QsVariation = z.object({
  ref: z.string().min(1),
  quantity: z.number().nonnegative(),
  rate: z.number().optional(),
  basis: z.enum(['boq_rate', 'pro_rata', 'fair_rate', 'dayworks']),
  dayworks: QsDayworks,
});

/**
 * A SINGLE-variation register row — `ref` is optional because the singular
 * dispatch path returns one valued variation directly. The deterministic
 * dispatcher accepts BOTH this singular `variation` and the plural
 * `variations[]` array so the two QS call-shapes share one engine.
 */
const QsSingleVariation = z.object({
  ref: z.string().min(1).optional(),
  quantity: z.number().nonnegative(),
  rate: z.number().optional(),
  basis: z.enum(['boq_rate', 'pro_rata', 'fair_rate', 'dayworks']),
  dayworks: QsDayworks,
});

export const QsTaskSchema = z.enum(['cost_plan', 'ipc_valuation', 'variation', 'final_account', 'evm']);

export const CostEngineerQsInputSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  /** ISO 4217 code — multi-currency by construction; never hard-coded. */
  currency_code: z.string().length(3),
  riba_stage: RibaStage,
  task: QsTaskSchema,
  cost_plan: z
    .object({
      measured_works: z.array(QsBoqLine).min(1),
      preliminaries: z.number().nonnegative(),
      fees_fraction: z.number().min(0).max(1),
      risk_fraction: z.number().min(0).max(1),
      inflation_fraction: z.number().min(0).max(1),
    })
    .optional(),
  ipc: z
    .object({
      work_done_to_date: z.number().nonnegative(),
      materials_on_site: z.number().nonnegative(),
      variations_to_date: z.number(),
      retention_fraction: z.number().min(0).max(1),
      retention_limit_fraction: z.number().min(0).max(1),
      contract_sum: z.number().positive(),
      previously_certified: z.number().nonnegative(),
    })
    .optional(),
  /** Plural register — backward-compatible batch of variations. */
  variations: z.array(QsVariation).optional(),
  /** Singular register — a single variation valued on its own. */
  variation: QsSingleVariation.optional(),
  final_account: z
    .object({
      original_contract_sum: z.number().positive(),
      remeasured_adjustment: z.number(),
      total_variations: z.number(),
      settled_claims: z.number().nonnegative(),
      fluctuations: z.number(),
      total_certified_to_date: z.number().nonnegative(),
    })
    .optional(),
  evm: z
    .object({
      planned_value: z.number().nonnegative(),
      earned_value: z.number().nonnegative(),
      actual_cost: z.number().nonnegative(),
      budget_at_completion: z.number().positive(),
    })
    .optional(),
});
export type CostEngineerQsInput = z.infer<typeof CostEngineerQsInputSchema>;

export const CostEngineerQsOutput = AuditedOutputBase.extend({
  project_id: z.string(),
  currency_code: z.string().length(3),
  task: QsTaskSchema,
  riba_stage: RibaStage,
  /** Deterministic figures computed by qs-engine — the source of truth. */
  computed: z.record(z.string(), z.unknown()),
  /** True when a money event is implied (IPC/variation/final account). */
  posts_to_ledger: z.boolean(),
  /** Human-readable QS commentary from the LLM port over `computed`. */
  qs_commentary: z.string().min(1),
  stage_gate_warning: z.string().nullable(),
});
export type CostEngineerQsOutput = z.infer<typeof CostEngineerQsOutput>;

// ─────────────────────────────────────────────────────────────────────
// QS capability — prompt (LLM port narrates over verified numbers)
// ─────────────────────────────────────────────────────────────────────

export const COST_ENGINEER_QS_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Cost Engineer Agent (Quantity Surveyor)',
  mandate:
    'Act as a RICS-grade Quantity Surveyor for the estate construction programme. The numbers are ALREADY computed ' +
    'deterministically (NRM1 cost plan, NRM2 rate build-up, §5 IPC/variation/retention/final account, §8.1 EVM) — ' +
    'NEVER recompute or alter them. Narrate the COMPUTED figures, flag the most material drivers and risks, and call ' +
    'out RIBA stage-gate discipline (never let cost run ahead of the gate).',
  tools:
    'build_unit_rate(NRM2), build_cost_plan(NRM1), valuate_ipc(§5), valuate_variation(§5), reconcile_final_account(§5), compute_evm(§8.1).',
  evidence:
    'Cite the construction dossier section grounding the figure (NRM1/NRM2 §2, IPC/variation/retention/final-account §5, EVM §8.1) ' +
    'and the input line keys (BOQ codes, variation refs) feeding the computation.',
  outputSchema:
    '{ "project_id": string, "currency_code": string, "task": string, "riba_stage": string, "computed": object, ' +
    '"posts_to_ledger": boolean, "qs_commentary": string, "stage_gate_warning": string|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain:
    'computational + advisory; PRODUCES valuations only — NEVER posts money (LedgerService.post() owns the money path).',
  hardRules: [
    'Never recompute or override the deterministic figures in COMPUTED — they are the verified source of truth.',
    'Never smear preliminaries into measured unit rates (NRM2 §2.2 — prelims priced separately).',
    'Read CPI and SPI together — under budget (CPI>1) can still be behind schedule (SPI<1).',
    'Never let cost/procurement run ahead of the RIBA gate; flag stage_4/5 spend on a stage_2 design.',
    'Derive contingency from risk allowance, never arbitrary padding.',
    'Echo the currency_code; never assume or hard-code TZS/USD.',
  ],
});

/**
 * Pure QS dispatcher input. Structurally identical to
 * {@link CostEngineerQsInput} — it accepts BOTH the singular `variation`
 * (one variation valued on its own) and the plural `variations[]` batch so
 * the deterministic engine has a single entry point regardless of call
 * shape.
 */
export type QsInput = CostEngineerQsInput;

/**
 * Money tasks (IPC / variation / final account) imply a ledger event;
 * cost-plan and EVM are advisory-only. Centralised so the dispatcher and
 * `processQs` agree on the money flag.
 */
const MONEY_TASKS: ReadonlySet<CostEngineerQsInput['task']> = new Set([
  'ipc_valuation',
  'variation',
  'final_account',
]);

/**
 * Deterministic QS dispatcher — runs the relevant `qs-engine` function for
 * the task and returns the COMPUTED object directly (no LLM, no envelope):
 *   - `cost_plan`     → `{ cost_plan }`
 *   - `ipc_valuation` → `{ ipc, retention_release }`
 *   - `variation`     → `{ variation: { basis, value } }`  (singular)
 *                       or `{ variations: [...], total }`   (plural batch)
 *   - `final_account` → `{ final_account }`
 *   - `evm`           → `{ evm }`
 *
 * Throws `"<task> payload required"` (e.g. "ipc_valuation payload required")
 * when the task's payload is absent. Shared verbatim by `processQs`.
 */
export function runQsTask(input: QsInput): Record<string, unknown> {
  switch (input.task) {
    case 'cost_plan': {
      if (!input.cost_plan) throw new Error('cost_plan payload required');
      const measured_works: BoqLine[] = input.cost_plan.measured_works.map((l) => ({
        code: l.code,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate ?? buildUnitRate(requireBuildup(l)).unit_rate,
      }));
      return { cost_plan: buildCostPlan({ ...input.cost_plan, measured_works }) };
    }
    case 'ipc_valuation': {
      if (!input.ipc) throw new Error('ipc_valuation payload required');
      const ipc = valuateIpc(input.ipc);
      return { ipc, retention_release: retentionReleaseSchedule(ipc.retention_held) };
    }
    case 'variation': {
      // Singular `variation` wins when present; otherwise fall back to the
      // plural `variations[]` batch. Either way at least one is required.
      if (input.variation) {
        const v = input.variation;
        return {
          variation: valuateVariation({
            quantity: v.quantity,
            basis: v.basis,
            ...(v.rate !== undefined ? { rate: v.rate } : {}),
            ...(v.dayworks !== undefined ? { dayworks: v.dayworks } : {}),
          }),
        };
      }
      if (input.variations?.length) {
        const valued = input.variations.map((v) => ({
          ref: v.ref,
          ...valuateVariation({
            quantity: v.quantity,
            basis: v.basis,
            ...(v.rate !== undefined ? { rate: v.rate } : {}),
            ...(v.dayworks !== undefined ? { dayworks: v.dayworks } : {}),
          }),
        }));
        return { variations: valued, total: round2Sum(valued.map((vv) => vv.value)) };
      }
      throw new Error('variation payload required');
    }
    case 'final_account': {
      if (!input.final_account) throw new Error('final_account payload required');
      return { final_account: reconcileFinalAccount(input.final_account) };
    }
    case 'evm': {
      if (!input.evm) throw new Error('evm payload required');
      return { evm: computeEvm(input.evm) };
    }
    default:
      throw new Error(`unknown QS task ${String(input.task)}`);
  }
}

/**
 * `processQs` wrapper over {@link runQsTask}: returns the computed object
 * plus the deterministic money flag derived from the task type.
 */
function computeQs(input: CostEngineerQsInput): { computed: Record<string, unknown>; posts: boolean } {
  return { computed: runQsTask(input), posts: MONEY_TASKS.has(input.task) };
}

// ─────────────────────────────────────────────────────────────────────
// RIBA stage-gate guard (deterministic)
// ─────────────────────────────────────────────────────────────────────

/**
 * RIBA stages at which a project is construction-ready and may certify a
 * money event (IPC / variation / final account). Certifying money on an
 * earlier design stage is a stage-gate breach — cost/procurement must not
 * run ahead of the gate (dossier §5 / NRM discipline).
 */
const CONSTRUCTION_READY_STAGES: ReadonlySet<CostEngineerQsInput['riba_stage']> = new Set([
  'stage_4_technical_design',
  'stage_5_manufacturing_construction',
  'stage_6_handover',
  'stage_7_use',
]);

/**
 * Deterministic stage-gate verdict. `null` when the task is non-money or
 * the stage is construction-ready; otherwise a `"Stage-gate breach"`
 * string flagging a money event certified on an early design stage.
 */
function stageGateWarning(input: CostEngineerQsInput): string | null {
  if (!MONEY_TASKS.has(input.task)) return null;
  if (CONSTRUCTION_READY_STAGES.has(input.riba_stage)) return null;
  return (
    `Stage-gate breach: a money event (${input.task}) is being certified at ${input.riba_stage}, ` +
    `before the project is construction-ready (RIBA stage 4+). Cost/procurement must not run ahead of the gate.`
  );
}

function requireBuildup(line: z.infer<typeof QsBoqLine>) {
  if (!line.rate_buildup) {
    throw new Error(`cost-engineer.qs: BOQ line ${line.code} needs either an explicit rate or a rate_buildup`);
  }
  return line.rate_buildup;
}

function round2Sum(values: ReadonlyArray<number>): number {
  return Math.round((values.reduce((s, v) => s + v, 0) + Number.EPSILON) * 100) / 100;
}

function buildQsUserPrompt(input: CostEngineerQsInput, computed: Record<string, unknown>): string {
  return [
    `TENANT: ${input.tenantId}  PROJECT: ${input.projectId}  CURRENCY: ${input.currency_code}`,
    `RIBA_STAGE: ${input.riba_stage}  TASK: ${input.task}`,
    `COMPUTED (verified, do not alter):`,
    JSON.stringify(computed, null, 2).slice(0, 6_000),
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
     * Quantity-Surveying capability. Computes the construction figure
     * deterministically (qs-engine), then asks the LLM port to narrate
     * over the VERIFIED numbers. `posts_to_ledger` is forced from the
     * deterministic task type so the LLM cannot mis-flag a money event.
     */
    async processQs(input: CostEngineerQsInput): Promise<CostEngineerQsOutput> {
      const validated = CostEngineerQsInputSchema.parse(input);
      const { computed, posts } = computeQs(validated);

      const narrated = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'cost-engineer-qs',
        schema: CostEngineerQsOutput,
        systemPrompt: COST_ENGINEER_QS_SYSTEM_PROMPT,
        userPrompt: buildQsUserPrompt(validated, computed),
        maxTokens: 2500,
      });

      // Deterministic fields override the LLM — numbers, money-flag AND the
      // RIBA stage-gate verdict are authoritative from the engine, never the
      // model (whose "IGNORED" stage_gate_warning must never leak).
      const output: CostEngineerQsOutput = {
        ...narrated,
        project_id: validated.projectId,
        currency_code: validated.currency_code,
        task: validated.task,
        riba_stage: validated.riba_stage,
        computed,
        posts_to_ledger: posts,
        stage_gate_warning: stageGateWarning(validated),
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
