/**
 * World-model kernel tools — agent-loop callable wrappers around the
 * trajectory + regime-detection primitives.
 *
 * Three tools:
 *   - world.property_trajectory     forward-simulate a property
 *   - world.arrears_trajectory      forecast tenant arrears + default
 *   - world.market_regime           classify agency-level regime
 *
 * Each tool takes a fetcher dependency that returns the historical
 * series. The composition root binds a Drizzle / repo reader; tests
 * supply a mocked fetcher. Errors NEVER throw out of `invoke` — they
 * collapse to `{ kind: 'error' }` so the agent loop can render them
 * back to the model for self-correction.
 *
 * Citations target the `forecast` kind in `CitationTarget`. The
 * forecastId is a stable hash of (toolName, primaryKey, point0Iso) so
 * a downstream UI can deduplicate identical forecasts and the audit
 * trail can replay them.
 */

import { createHash } from 'node:crypto';
import type {
  Citation,
  ScopeContext,
  Tool,
  ToolInput,
  ToolOutcome,
} from '../../types.js';
import {
  forecastPropertyTrajectory,
  forecastTenantArrearsTrajectory,
  type ArrearsTrajectory,
  type PropertyTrajectory,
} from './trajectory.js';
import {
  detectMarketRegime,
  type RegimeSignal,
} from './regime-detector.js';
import type {
  AgencyState,
  PropertyState,
  TenantState,
} from './state-vectors.js';

// ─────────────────────────────────────────────────────────────────────
// Inputs / outputs
// ─────────────────────────────────────────────────────────────────────

export interface PropertyTrajectoryInput {
  readonly propertyId: string;
  readonly horizonDays?: number;
  readonly samplePoints?: number;
}

export interface ArrearsTrajectoryInput {
  readonly leaseId: string;
  readonly horizonDays?: number;
  readonly samplePoints?: number;
}

export interface MarketRegimeInput {
  readonly tenantId: string;
}

// ─────────────────────────────────────────────────────────────────────
// Fetcher dependency shapes — composition root binds these to a real
// historical-state reader; tests pass a spy.
// ─────────────────────────────────────────────────────────────────────

export interface PropertyTrajectoryToolDeps {
  readonly fetchHistory: (
    propertyId: string,
  ) => Promise<ReadonlyArray<PropertyState>>;
}

export interface ArrearsTrajectoryToolDeps {
  readonly fetchTenantHistory: (
    leaseId: string,
  ) => Promise<ReadonlyArray<TenantState>>;
}

export interface MarketRegimeToolDeps {
  readonly fetchAgencyHistory: (
    tenantId: string,
  ) => Promise<ReadonlyArray<AgencyState>>;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function errorOutcome(message: string, retryable = false): ToolOutcome<never> {
  return { kind: 'error', message, retryable };
}

function forecastId(
  toolName: string,
  primaryKey: string,
  observedAt: string,
): string {
  return createHash('sha256')
    .update(`${toolName}|${primaryKey}|${observedAt}`)
    .digest('hex')
    .slice(0, 32);
}

function forecastCitation(
  toolName: string,
  primaryKey: string,
  observedAt: string,
  label: string,
  confidence = 0.75,
): Citation {
  const id = forecastId(toolName, primaryKey, observedAt);
  return {
    id: `forecast:${toolName}:${id}`,
    target: {
      kind: 'forecast',
      forecastId: id,
    },
    label,
    confidence,
  };
}

function assertTenantOrPlatform(
  ctx: ScopeContext,
): { ok: true } | { ok: false; message: string } {
  if (ctx.kind !== 'tenant' && ctx.kind !== 'platform') {
    return { ok: false, message: 'world-model kernel tool: unsupported scope' };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 1 — world.property_trajectory
// ─────────────────────────────────────────────────────────────────────

export function createPropertyTrajectoryTool(
  deps: PropertyTrajectoryToolDeps,
): Tool<PropertyTrajectoryInput, PropertyTrajectory> {
  return {
    name: 'world.property_trajectory',
    description:
      'Forward-simulate a property\'s state vector (vacancy, rent, ' +
      'arrears, work-order backlog, condition) over a forecast horizon. ' +
      'Returns the regime classification (stable / recovering / declining ' +
      '/ volatile) and any horizon-day where vacancy or arrears crosses ' +
      'a notable threshold.',
    inputJsonSchema: {
      type: 'object',
      required: ['propertyId'],
      properties: {
        propertyId: {
          type: 'string',
          minLength: 1,
        },
        horizonDays: {
          type: 'integer',
          minimum: 1,
          maximum: 1825,
          default: 90,
        },
        samplePoints: {
          type: 'integer',
          minimum: 2,
          maximum: 30,
          default: 6,
        },
      },
      additionalProperties: false,
    },
    scopes: ['tenant', 'platform'],
    async invoke(
      args: ToolInput<PropertyTrajectoryInput>,
    ): Promise<ToolOutcome<PropertyTrajectory>> {
      const startedAt = Date.now();
      const guard = assertTenantOrPlatform(args.ctx);
      if (!guard.ok) return errorOutcome(guard.message);

      const { propertyId } = args.input;
      if (!propertyId) {
        return errorOutcome('world.property_trajectory: propertyId is required');
      }

      let history: ReadonlyArray<PropertyState>;
      try {
        history = await deps.fetchHistory(propertyId);
      } catch (err) {
        return errorOutcome(
          `world.property_trajectory fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
      if (history.length === 0) {
        return errorOutcome(
          `world.property_trajectory: no history for property ${propertyId}`,
        );
      }

      let trajectory: PropertyTrajectory;
      try {
        trajectory = forecastPropertyTrajectory({
          history,
          ...(typeof args.input.horizonDays === 'number'
            ? { horizonDays: args.input.horizonDays }
            : {}),
          ...(typeof args.input.samplePoints === 'number'
            ? { samplePoints: args.input.samplePoints }
            : {}),
        });
      } catch (err) {
        return errorOutcome(
          `world.property_trajectory failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        kind: 'ok',
        ok: true,
        output: trajectory,
        latencyMs: Date.now() - startedAt,
        citations: [
          forecastCitation(
            'world.property_trajectory',
            propertyId,
            trajectory.point0.observedAt,
            `property ${propertyId} ${trajectory.regime} regime, ${trajectory.forecast.length}-pt forecast`,
          ),
        ],
        artifact: null,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 2 — world.arrears_trajectory
// ─────────────────────────────────────────────────────────────────────

export function createArrearsTrajectoryTool(
  deps: ArrearsTrajectoryToolDeps,
): Tool<ArrearsTrajectoryInput, ArrearsTrajectory> {
  return {
    name: 'world.arrears_trajectory',
    description:
      'Forecast a lease\'s arrears amount + default probability over a ' +
      'horizon. Returns expected/p10/p90 bands per sample point and a ' +
      'companion default-probability series. Useful for arrears-stage ' +
      'triage and proactive outreach.',
    inputJsonSchema: {
      type: 'object',
      required: ['leaseId'],
      properties: {
        leaseId: {
          type: 'string',
          minLength: 1,
        },
        horizonDays: {
          type: 'integer',
          minimum: 1,
          maximum: 1825,
          default: 90,
        },
        samplePoints: {
          type: 'integer',
          minimum: 2,
          maximum: 30,
          default: 6,
        },
      },
      additionalProperties: false,
    },
    scopes: ['tenant', 'platform'],
    async invoke(
      args: ToolInput<ArrearsTrajectoryInput>,
    ): Promise<ToolOutcome<ArrearsTrajectory>> {
      const startedAt = Date.now();
      const guard = assertTenantOrPlatform(args.ctx);
      if (!guard.ok) return errorOutcome(guard.message);

      const { leaseId } = args.input;
      if (!leaseId) {
        return errorOutcome('world.arrears_trajectory: leaseId is required');
      }

      let history: ReadonlyArray<TenantState>;
      try {
        history = await deps.fetchTenantHistory(leaseId);
      } catch (err) {
        return errorOutcome(
          `world.arrears_trajectory fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
      if (history.length === 0) {
        return errorOutcome(
          `world.arrears_trajectory: no history for lease ${leaseId}`,
        );
      }

      let trajectory: ArrearsTrajectory;
      try {
        trajectory = forecastTenantArrearsTrajectory({
          history,
          ...(typeof args.input.horizonDays === 'number'
            ? { horizonDays: args.input.horizonDays }
            : {}),
          ...(typeof args.input.samplePoints === 'number'
            ? { samplePoints: args.input.samplePoints }
            : {}),
        });
      } catch (err) {
        return errorOutcome(
          `world.arrears_trajectory failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        kind: 'ok',
        ok: true,
        output: trajectory,
        latencyMs: Date.now() - startedAt,
        citations: [
          forecastCitation(
            'world.arrears_trajectory',
            leaseId,
            trajectory.point0.observedAt,
            `lease ${leaseId} arrears trajectory, ${trajectory.arrearsAmountMajorAt.length} pts`,
          ),
        ],
        artifact: null,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 3 — world.market_regime
// ─────────────────────────────────────────────────────────────────────

export function createMarketRegimeTool(
  deps: MarketRegimeToolDeps,
): Tool<MarketRegimeInput, RegimeSignal> {
  return {
    name: 'world.market_regime',
    description:
      'Classify the agency-level market regime as stable, tightening, ' +
      'loosening, or shock. Uses the agency\'s historical state vector ' +
      'series. Useful for choosing between conservative and aggressive ' +
      'rent / collections strategy.',
    inputJsonSchema: {
      type: 'object',
      required: ['tenantId'],
      properties: {
        tenantId: {
          type: 'string',
          minLength: 1,
        },
      },
      additionalProperties: false,
    },
    scopes: ['tenant', 'platform'],
    async invoke(
      args: ToolInput<MarketRegimeInput>,
    ): Promise<ToolOutcome<RegimeSignal>> {
      const startedAt = Date.now();
      const guard = assertTenantOrPlatform(args.ctx);
      if (!guard.ok) return errorOutcome(guard.message);

      const { tenantId } = args.input;
      if (!tenantId) {
        return errorOutcome('world.market_regime: tenantId is required');
      }

      let history: ReadonlyArray<AgencyState>;
      try {
        history = await deps.fetchAgencyHistory(tenantId);
      } catch (err) {
        return errorOutcome(
          `world.market_regime fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
      if (history.length === 0) {
        return errorOutcome(
          `world.market_regime: no history for tenant ${tenantId}`,
        );
      }

      const portfolio = history[history.length - 1] as AgencyState;
      const signal = detectMarketRegime({ portfolio, history });

      return {
        kind: 'ok',
        ok: true,
        output: signal,
        latencyMs: Date.now() - startedAt,
        citations: [
          forecastCitation(
            'world.market_regime',
            tenantId,
            portfolio.observedAt,
            `tenant ${tenantId} regime: ${signal.regime}`,
            signal.confidence,
          ),
        ],
        artifact: null,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bundle — convenience factory binding all three tools to one set of
// fetchers. Composition root passes the `all` array straight into the
// agent-loop's tool-registry input.
// ─────────────────────────────────────────────────────────────────────

export interface WorldModelToolDeps {
  readonly fetchPropertyHistory: (
    propertyId: string,
  ) => Promise<ReadonlyArray<PropertyState>>;
  readonly fetchTenantHistory: (
    leaseId: string,
  ) => Promise<ReadonlyArray<TenantState>>;
  readonly fetchAgencyHistory: (
    tenantId: string,
  ) => Promise<ReadonlyArray<AgencyState>>;
}

export interface WorldModelKernelToolBundle {
  readonly propertyTrajectory: Tool<PropertyTrajectoryInput, PropertyTrajectory>;
  readonly arrearsTrajectory: Tool<ArrearsTrajectoryInput, ArrearsTrajectory>;
  readonly marketRegime: Tool<MarketRegimeInput, RegimeSignal>;
  readonly all: ReadonlyArray<Tool>;
}

export function createWorldModelKernelTools(
  deps: WorldModelToolDeps,
): WorldModelKernelToolBundle {
  const propertyTrajectory = createPropertyTrajectoryTool({
    fetchHistory: deps.fetchPropertyHistory,
  });
  const arrearsTrajectory = createArrearsTrajectoryTool({
    fetchTenantHistory: deps.fetchTenantHistory,
  });
  const marketRegime = createMarketRegimeTool({
    fetchAgencyHistory: deps.fetchAgencyHistory,
  });
  return {
    propertyTrajectory,
    arrearsTrajectory,
    marketRegime,
    all: Object.freeze([
      propertyTrajectory,
      arrearsTrajectory,
      marketRegime,
    ] as ReadonlyArray<Tool>),
  };
}
