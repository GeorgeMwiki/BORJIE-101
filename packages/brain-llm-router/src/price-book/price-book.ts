/**
 * PriceBook — THE single source of truth for USD-per-1K-token model
 * rates used by cost TELEMETRY. Never routing: no caller may key a
 * routing decision off these figures (Intelligence-Elasticity law).
 *
 * Consolidates the two formerly-duplicated frozen tables:
 *
 *   - `packages/ai-copilot/src/governance/ai-governance.ts`
 *     (`AIGovernanceService.costPerToken`)
 *   - `packages/central-intelligence/src/kernel/semantic-cache/
 *     semantic-cache.ts` (SONNET/OPUS/HAIKU `ModelCostRate` consts)
 *
 * Contract:
 *
 *   - `getRates(modelId)` is TOTAL — unknown ids fall back to the
 *     `'default'` row (Sonnet-class rates, the Borjie default executor)
 *     so a registry-resolved NEWER model id degrades to approximate
 *     cost figures, never an error and never an overcharge surprise.
 *   - The in-code table below is the FROZEN fallback (same figures both
 *     former consumers shipped). A registry/db-backed source can be
 *     injected via `createPriceBook({ source })` and pulled with
 *     `refresh()`; fresh rows merge OVER the fallback immutably.
 *   - Anthropic rows are keyed off the dynamic-registry L3 baselines
 *     (`MODELS`) so the id spelling lives in exactly ONE place and an
 *     operator baseline override re-keys the telemetry rows with it.
 *
 * @module @borjie/brain-llm-router/price-book
 */

import { MODELS } from '../dynamic-registry/baselines.js';

export interface ModelPriceRate {
  readonly modelId: string;
  /** USD per 1K input/prompt tokens. */
  readonly promptUsdPer1k: number;
  /** USD per 1K output/completion tokens. */
  readonly completionUsdPer1k: number;
}

function rate(
  modelId: string,
  promptUsdPer1k: number,
  completionUsdPer1k: number,
): ModelPriceRate {
  return Object.freeze({ modelId, promptUsdPer1k, completionUsdPer1k });
}

/**
 * Anthropic rows, keyed by the dynamic-registry baseline ids (operator-
 * overridable via `BORJIE_MODEL_BASELINE_<FAMILY>` — read at module load
 * by `baselines.ts`, not here).
 */
export const ANTHROPIC_PRICE_RATES: Readonly<{
  fable: ModelPriceRate;
  opus: ModelPriceRate;
  sonnet: ModelPriceRate;
  haiku: ModelPriceRate;
}> = Object.freeze({
  // Fable — frontier core-reasoning family. Priced at the opus tier as a
  // conservative estimate until a published rate is wired (telemetry/cost-
  // estimation only, not billing); operator overrides the id via baselines.
  fable: rate(MODELS.fable, 0.005, 0.025),
  opus: rate(MODELS.opus, 0.005, 0.025),
  sonnet: rate(MODELS.sonnet, 0.003, 0.015),
  haiku: rate(MODELS.haiku, 0.0008, 0.004),
});

/** The id of the total-fallback row returned for unknown models. */
export const DEFAULT_PRICE_RATE_ID = 'default';

/**
 * The ONE frozen in-code price table. Legacy OpenAI ids serve the
 * copilots still routed via the OpenAIProvider; `'default'` mirrors
 * Sonnet so unknown models never silently overcharge.
 */
export const PRICE_BOOK_FALLBACK_RATES: ReadonlyArray<ModelPriceRate> =
  Object.freeze([
    ANTHROPIC_PRICE_RATES.fable,
    ANTHROPIC_PRICE_RATES.opus,
    ANTHROPIC_PRICE_RATES.sonnet,
    ANTHROPIC_PRICE_RATES.haiku,
    rate('gpt-4-turbo-preview', 0.01, 0.03),
    rate('gpt-4-turbo', 0.01, 0.03),
    rate('gpt-4', 0.03, 0.06),
    rate('gpt-3.5-turbo', 0.0005, 0.0015),
    rate(DEFAULT_PRICE_RATE_ID, 0.003, 0.015),
  ]);

/** Injectable refresh seam — e.g. a registry endpoint or db price row. */
export interface PriceBookSource {
  load(): Promise<ReadonlyArray<ModelPriceRate>>;
}

export interface PriceBookLogger {
  warn?(meta: Record<string, unknown>, msg: string): void;
}

export interface PriceBook {
  /** Total — unknown ids return the `'default'` row. Never throws. */
  getRates(modelId: string): ModelPriceRate;
  /** Every model id currently priced (fallback ∪ refreshed rows). */
  listModelIds(): ReadonlyArray<string>;
  /**
   * Pull from the injected source and merge valid rows over the
   * fallback table (new snapshot — no mutation). No-op without a
   * source; swallows source faults (telemetry must never break the
   * caller). Returns the number of rows merged.
   */
  refresh(): Promise<number>;
}

function isValidRate(row: unknown): row is ModelPriceRate {
  if (typeof row !== 'object' || row === null) return false;
  const candidate = row as Partial<ModelPriceRate>;
  return (
    typeof candidate.modelId === 'string' &&
    candidate.modelId.length > 0 &&
    typeof candidate.promptUsdPer1k === 'number' &&
    Number.isFinite(candidate.promptUsdPer1k) &&
    candidate.promptUsdPer1k >= 0 &&
    typeof candidate.completionUsdPer1k === 'number' &&
    Number.isFinite(candidate.completionUsdPer1k) &&
    candidate.completionUsdPer1k >= 0
  );
}

function buildTable(
  rows: ReadonlyArray<ModelPriceRate>,
): ReadonlyMap<string, ModelPriceRate> {
  return new Map(rows.map((r) => [r.modelId, r]));
}

export function createPriceBook(
  opts: {
    readonly source?: PriceBookSource;
    readonly logger?: PriceBookLogger;
  } = {},
): PriceBook {
  let table: ReadonlyMap<string, ModelPriceRate> = buildTable(
    PRICE_BOOK_FALLBACK_RATES,
  );

  return Object.freeze({
    getRates(modelId: string): ModelPriceRate {
      return (
        table.get(modelId) ??
        table.get(DEFAULT_PRICE_RATE_ID) ??
        ANTHROPIC_PRICE_RATES.sonnet
      );
    },
    listModelIds(): ReadonlyArray<string> {
      return Object.freeze([...table.keys()]);
    },
    async refresh(): Promise<number> {
      if (!opts.source) return 0;
      try {
        const rows = await opts.source.load();
        const valid = (rows ?? []).filter(isValidRate).map((r) =>
          rate(r.modelId, r.promptUsdPer1k, r.completionUsdPer1k),
        );
        if (valid.length === 0) return 0;
        // Later rows win — fresh source rows shadow the fallback.
        table = buildTable([...PRICE_BOOK_FALLBACK_RATES, ...valid]);
        return valid.length;
      } catch (error) {
        opts.logger?.warn?.(
          { err: error instanceof Error ? error.message : String(error) },
          'price-book: refresh failed — keeping previous snapshot',
        );
        return 0;
      }
    },
  });
}

let defaultBook: PriceBook | null = null;

/**
 * Lazy fallback-only singleton for consumers that just need the frozen
 * in-code table (no refresh source bound).
 */
export function getDefaultPriceBook(): PriceBook {
  if (defaultBook === null) {
    defaultBook = createPriceBook();
  }
  return defaultBook;
}
