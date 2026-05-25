/**
 * Market data kernel tools — wraps a `MarketDataPort` (Zillow / Airbnb /
 * etc.) into Tool definitions the streaming agent-loop can invoke.
 *
 * Two tools, both platform-scope (external-market data is industry-tier
 * intelligence, not tenant-scoped):
 *
 *   - market.comparable_rents
 *   - market.vacancy_trends
 *
 * The MarketDataPort is duck-typed locally so this module does not
 * compile-time-depend on @borjie/market-intelligence (mirrors the
 * graph-tools pattern with @borjie/graph-sync). The api-gateway
 * sovereign composition root binds a concrete adapter at runtime.
 *
 * Outcome translation:
 *   - port `ok`           → ToolOutcome `ok` with mapped output + a
 *                           platform_aggregate citation whose
 *                           sliceFingerprint is a hash of the query
 *   - port `unconfigured` → ToolOutcome `error` with a friendly hint
 *                           the model can surface
 *   - port `error`        → ToolOutcome `error` (retryable)
 *
 * Errors NEVER throw out of `invoke` — they collapse to a structured
 * `{ kind: 'error' }` outcome the agent-loop renders back to the model.
 */

import { createHash } from 'node:crypto';
import type {
  Citation,
  ScopeContext,
  Tool,
  ToolInput,
  ToolOutcome,
} from '../../types.js';

// ─────────────────────────────────────────────────────────────────────
// Duck-typed port — kept in lock-step with the MarketDataPort shape
// in @borjie/market-intelligence/src/port.ts. Don't add the real
// import; the composition root supplies the runtime instance.
// ─────────────────────────────────────────────────────────────────────

export interface MarketDataPortShape {
  readonly provider: string;
  fetchComparableRents(args: {
    readonly jurisdiction: string;
    readonly propertyClass: string;
    readonly bedrooms?: number;
    readonly squareFeet?: number;
    readonly windowDays: number;
  }): Promise<MarketDataOutcomeShape<ReadonlyArray<MarketComparableRent>>>;
  fetchVacancyTrends(args: {
    readonly jurisdiction: string;
    readonly propertyClass: string;
    readonly windowDays: number;
  }): Promise<MarketDataOutcomeShape<MarketVacancyTrend>>;
}

export type MarketDataOutcomeShape<T> =
  | {
      readonly kind: 'ok';
      readonly data: T;
      readonly cached: boolean;
      readonly fetchedAt: string;
    }
  | {
      readonly kind: 'unconfigured';
      readonly provider: string;
      readonly hint: string;
    }
  | {
      readonly kind: 'error';
      readonly provider: string;
      readonly message: string;
    };

export interface MarketComparableRent {
  readonly rentMajor: number;
  readonly currency: string;
  readonly bedrooms: number;
  readonly squareFeet: number | null;
  readonly addressFingerprint: string;
  readonly observedAt: string;
}

export interface MarketVacancyTrend {
  readonly meanDaysVacant: number;
  readonly p50DaysVacant: number;
  readonly p90DaysVacant: number;
  readonly sampleSize: number;
  readonly observedAt: string;
}

export interface MarketDataToolDeps {
  readonly port: MarketDataPortShape;
}

// ─────────────────────────────────────────────────────────────────────
// Inputs / outputs
// ─────────────────────────────────────────────────────────────────────

export interface ComparableRentsInput {
  readonly jurisdiction: string;
  readonly propertyClass: string;
  readonly bedrooms?: number;
  readonly squareFeet?: number;
  readonly windowDays?: number;
}

export interface ComparableRentsOutput {
  readonly provider: string;
  readonly cached: boolean;
  readonly fetchedAt: string;
  readonly comparables: ReadonlyArray<MarketComparableRent>;
}

export interface VacancyTrendsInput {
  readonly jurisdiction: string;
  readonly propertyClass: string;
  readonly windowDays?: number;
}

export interface VacancyTrendsOutput {
  readonly provider: string;
  readonly cached: boolean;
  readonly fetchedAt: string;
  readonly trend: MarketVacancyTrend;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function errorOutcome(message: string, retryable = false): ToolOutcome<never> {
  return { kind: 'error', message, retryable };
}

function sliceFingerprint(
  provider: string,
  op: string,
  args: Record<string, unknown>,
): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256')
    .update(`${provider}|${op}|${canonical}`)
    .digest('hex')
    .slice(0, 32);
}

function platformCitation(
  provider: string,
  statistic: string,
  fingerprint: string,
  label: string,
  confidence = 0.85,
): Citation {
  return {
    id: `market.${statistic}:${provider}:${fingerprint}`,
    target: {
      kind: 'platform_aggregate',
      statistic: `${provider}-${statistic}`,
      sliceFingerprint: fingerprint,
    },
    label,
    confidence,
  };
}

function assertPlatformOrTenant(
  ctx: ScopeContext,
): { ok: true } | { ok: false; message: string } {
  // Platform-tier external data is callable from either scope — a
  // tenant-scope user asking "what's the market rent for a 2BR in
  // Brooklyn" should get the same answer as a platform user.
  if (ctx.kind !== 'platform' && ctx.kind !== 'tenant') {
    return { ok: false, message: 'market kernel tool: unsupported scope' };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 1 — market.comparable_rents
// ─────────────────────────────────────────────────────────────────────

export function createMarketComparableRentsTool(
  deps: MarketDataToolDeps,
): Tool<ComparableRentsInput, ComparableRentsOutput> {
  const provider = deps.port.provider;

  return {
    name: 'market.comparable_rents',
    description:
      'Fetch external comparable-rent observations for a jurisdiction + ' +
      'property class. Backed by a configured market-data provider ' +
      `(${provider}). Returns recent rent observations with privacy-` +
      'fingerprinted addresses. Useful for rent-recommendation, vacancy ' +
      'analysis, and external benchmarking.',
    inputJsonSchema: {
      type: 'object',
      required: ['jurisdiction', 'propertyClass'],
      properties: {
        jurisdiction: {
          type: 'string',
          minLength: 1,
          description:
            'Free-form jurisdiction code, e.g. "TZ-DAR-ES-SALAAM", "KE-NAIROBI", "US-NY-BROOKLYN".',
        },
        propertyClass: {
          type: 'string',
          minLength: 1,
          description:
            'Free-form class label, e.g. "residential-2br", "commercial-office".',
        },
        bedrooms: {
          type: 'integer',
          minimum: 0,
          maximum: 20,
          description: 'Optional bedroom filter.',
        },
        squareFeet: {
          type: 'integer',
          minimum: 0,
          maximum: 1_000_000,
          description: 'Optional square-footage filter.',
        },
        windowDays: {
          type: 'integer',
          minimum: 1,
          maximum: 3650,
          default: 90,
          description: 'Recency filter — only consider observations within the last N days.',
        },
      },
      additionalProperties: false,
    },
    scopes: ['platform', 'tenant'],
    async invoke(
      args: ToolInput<ComparableRentsInput>,
    ): Promise<ToolOutcome<ComparableRentsOutput>> {
      const startedAt = Date.now();
      const guard = assertPlatformOrTenant(args.ctx);
      if (!guard.ok) return errorOutcome(guard.message);

      const { jurisdiction, propertyClass } = args.input;
      if (!jurisdiction) return errorOutcome('market.comparable_rents: jurisdiction is required');
      if (!propertyClass) return errorOutcome('market.comparable_rents: propertyClass is required');
      const windowDays = Math.min(Math.max(args.input.windowDays ?? 90, 1), 3650);

      let outcome: MarketDataOutcomeShape<ReadonlyArray<MarketComparableRent>>;
      try {
        outcome = await deps.port.fetchComparableRents({
          jurisdiction,
          propertyClass,
          ...(typeof args.input.bedrooms === 'number'
            ? { bedrooms: args.input.bedrooms }
            : {}),
          ...(typeof args.input.squareFeet === 'number'
            ? { squareFeet: args.input.squareFeet }
            : {}),
          windowDays,
        });
      } catch (err) {
        return errorOutcome(
          `market.comparable_rents failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }

      if (outcome.kind === 'unconfigured') {
        return errorOutcome(
          `market data adapter '${outcome.provider}' is not configured. ${outcome.hint}`,
        );
      }
      if (outcome.kind === 'error') {
        return errorOutcome(
          `market.comparable_rents (${outcome.provider}): ${outcome.message}`,
          true,
        );
      }

      const fp = sliceFingerprint(provider, 'comparable_rents', {
        jurisdiction,
        propertyClass,
        bedrooms: args.input.bedrooms ?? null,
        squareFeet: args.input.squareFeet ?? null,
        windowDays,
      });
      const output: ComparableRentsOutput = {
        provider,
        cached: outcome.cached,
        fetchedAt: outcome.fetchedAt,
        comparables: outcome.data,
      };

      return {
        kind: 'ok',
        ok: true,
        output,
        latencyMs: Date.now() - startedAt,
        citations: [
          platformCitation(
            provider,
            'comparable-rents',
            fp,
            `${provider} comparable rents for ${jurisdiction} (${output.comparables.length} obs)`,
          ),
        ],
        artifact: null,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 2 — market.vacancy_trends
// ─────────────────────────────────────────────────────────────────────

export function createMarketVacancyTrendsTool(
  deps: MarketDataToolDeps,
): Tool<VacancyTrendsInput, VacancyTrendsOutput> {
  const provider = deps.port.provider;

  return {
    name: 'market.vacancy_trends',
    description:
      'Fetch external vacancy-trend statistics (mean / p50 / p90 days vacant + ' +
      `sample size) for a jurisdiction + property class. Backed by ${provider}.`,
    inputJsonSchema: {
      type: 'object',
      required: ['jurisdiction', 'propertyClass'],
      properties: {
        jurisdiction: {
          type: 'string',
          minLength: 1,
        },
        propertyClass: {
          type: 'string',
          minLength: 1,
        },
        windowDays: {
          type: 'integer',
          minimum: 1,
          maximum: 3650,
          default: 90,
        },
      },
      additionalProperties: false,
    },
    scopes: ['platform', 'tenant'],
    async invoke(
      args: ToolInput<VacancyTrendsInput>,
    ): Promise<ToolOutcome<VacancyTrendsOutput>> {
      const startedAt = Date.now();
      const guard = assertPlatformOrTenant(args.ctx);
      if (!guard.ok) return errorOutcome(guard.message);

      const { jurisdiction, propertyClass } = args.input;
      if (!jurisdiction) return errorOutcome('market.vacancy_trends: jurisdiction is required');
      if (!propertyClass) return errorOutcome('market.vacancy_trends: propertyClass is required');
      const windowDays = Math.min(Math.max(args.input.windowDays ?? 90, 1), 3650);

      let outcome: MarketDataOutcomeShape<MarketVacancyTrend>;
      try {
        outcome = await deps.port.fetchVacancyTrends({
          jurisdiction,
          propertyClass,
          windowDays,
        });
      } catch (err) {
        return errorOutcome(
          `market.vacancy_trends failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }

      if (outcome.kind === 'unconfigured') {
        return errorOutcome(
          `market data adapter '${outcome.provider}' is not configured. ${outcome.hint}`,
        );
      }
      if (outcome.kind === 'error') {
        return errorOutcome(
          `market.vacancy_trends (${outcome.provider}): ${outcome.message}`,
          true,
        );
      }

      const fp = sliceFingerprint(provider, 'vacancy_trends', {
        jurisdiction,
        propertyClass,
        windowDays,
      });
      const output: VacancyTrendsOutput = {
        provider,
        cached: outcome.cached,
        fetchedAt: outcome.fetchedAt,
        trend: outcome.data,
      };

      return {
        kind: 'ok',
        ok: true,
        output,
        latencyMs: Date.now() - startedAt,
        citations: [
          platformCitation(
            provider,
            'vacancy-trends',
            fp,
            `${provider} vacancy trends for ${jurisdiction} (n=${output.trend.sampleSize})`,
          ),
        ],
        artifact: null,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bundle — convenience factory binding both tools to one port. The
// composition root passes the bundle.all array straight into the
// agent-loop's tool-registry input.
// ─────────────────────────────────────────────────────────────────────

export interface MarketDataKernelToolBundle {
  readonly comparableRents: Tool<ComparableRentsInput, ComparableRentsOutput>;
  readonly vacancyTrends: Tool<VacancyTrendsInput, VacancyTrendsOutput>;
  readonly all: ReadonlyArray<Tool>;
}

export function createMarketDataKernelTools(
  port: MarketDataPortShape,
): MarketDataKernelToolBundle {
  const deps: MarketDataToolDeps = { port };
  const comparableRents = createMarketComparableRentsTool(deps);
  const vacancyTrends = createMarketVacancyTrendsTool(deps);
  return {
    comparableRents,
    vacancyTrends,
    all: Object.freeze([comparableRents, vacancyTrends] as ReadonlyArray<Tool>),
  };
}

// Single-tool factory matching the spec's "createMarketDataTool" name —
// returns just the comparable-rents tool. Most callers should prefer
// `createMarketDataKernelTools` (the bundle).
export function createMarketDataTool(deps: MarketDataToolDeps): Tool {
  return createMarketComparableRentsTool(deps) as Tool;
}
