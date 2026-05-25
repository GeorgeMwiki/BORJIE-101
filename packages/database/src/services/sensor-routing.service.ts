/**
 * Sensor routing service — DB-backed control plane for the multi-LLM
 * router (LITFIN-parity, migration 0126).
 *
 * Public surface:
 *
 *   - recordSensorCall(args)        : append one row to `sensor_call_log`.
 *                                     Also debits the matching
 *                                     `tenant_budget_envelopes` row when
 *                                     a tenant is present and the call
 *                                     produced cost > 0.
 *
 *   - getBudgetStatus(args)         : read the current period envelope
 *                                     for a tenant. Returns null when
 *                                     no envelope is configured (the
 *                                     router treats null as "unbounded").
 *
 *   - selectSensorChain(task, tier) : read-only builtin chain for a
 *                                     (task, tenantTier) pair. The
 *                                     central-intelligence router calls
 *                                     this to get its primary + fallback
 *                                     list. The function does NOT touch
 *                                     the database — wiring DB-stored
 *                                     overrides is a follow-up so this
 *                                     service stays safe to add behind
 *                                     a feature flag.
 *
 * Hard DB failures degrade gracefully:
 *   - recordSensorCall : logs + swallows (telemetry must not break the
 *                        request that produced it)
 *   - getBudgetStatus  : returns null on error
 *
 * Stays read-only by default — wiring into the live router is a
 * follow-up (the service is deliberately decoupled so kernel changes
 * are isolated from this wave).
 */

import { randomUUID } from 'crypto';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { sensorCallLog } from '../schemas/sensor-call-log.schema.js';
import type { SensorCallOutcome } from '../schemas/sensor-call-log.schema.js';
import { tenantBudgetEnvelopes } from '../schemas/tenant-budget-envelopes.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type TenantTier = 'free' | 'growth' | 'enterprise';

export interface SensorChoice {
  readonly sensor: string;
  readonly maxTokens: number;
  /** Microdollars (1 USD = 1_000_000). Per-call ceiling. */
  readonly maxBudgetUsdMicroPerCall: number;
}

export interface SensorChainVerdict {
  readonly task: string;
  readonly tenantTier: TenantTier | null;
  readonly primary: SensorChoice;
  readonly fallbacks: ReadonlyArray<SensorChoice>;
  readonly cognitionMode: 'fast' | 'default' | 'deep';
  readonly source: 'builtin';
  readonly reasoning: string;
}

export interface RecordSensorCallArgs {
  readonly tenantId: string | null;
  readonly task: string;
  readonly sensor: string;
  readonly model?: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly outcome: SensorCallOutcome;
  readonly errorClass?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly costUsdMicro?: number;
  readonly latencyMs?: number;
  readonly thinkingActive?: boolean;
  readonly decisionTraceId?: string;
}

export interface BudgetStatus {
  readonly tenantId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly budgetUsdMicro: number;
  readonly consumedUsdMicro: number;
  readonly remainingUsdMicro: number;
  /** 0..1 ratio. 0 when budget is 0 (unconfigured). */
  readonly utilisation: number;
  readonly alertThresholdPct: number;
  readonly hardCapEnforced: boolean;
}

export interface SensorRoutingService {
  recordSensorCall(args: RecordSensorCallArgs): Promise<{ id: string }>;
  getBudgetStatus(args: {
    readonly tenantId: string;
    readonly now?: Date;
  }): Promise<BudgetStatus | null>;
  selectSensorChain(task: string, tier?: TenantTier): SensorChainVerdict;
}

// ─────────────────────────────────────────────────────────────────────
// Builtin sensor chains
//
// Property-management-shaped tasks. Tiered by tenant value so a free
// tenant gets Haiku-class on greetings and Sonnet on heavy work; an
// enterprise tenant pins Opus on high-stakes turns. Used as a safe
// default until the live router consumes DB overrides.
// ─────────────────────────────────────────────────────────────────────

const USD = 1_000_000; // microdollars per dollar
const CHEAP_PER_CALL = Math.round(0.01 * USD);
const MID_PER_CALL = Math.round(0.05 * USD);
const PREMIUM_PER_CALL = Math.round(0.2 * USD);

interface BuiltinRoute {
  readonly chain: ReadonlyArray<SensorChoice>;
  readonly cognitionMode: 'fast' | 'default' | 'deep';
  readonly reasoning: string;
}

const HAIKU: SensorChoice = {
  sensor: 'claude.haiku-4-5',
  maxTokens: 600,
  maxBudgetUsdMicroPerCall: CHEAP_PER_CALL,
};
const SONNET: SensorChoice = {
  sensor: 'claude.sonnet-4-6',
  maxTokens: 2000,
  maxBudgetUsdMicroPerCall: MID_PER_CALL,
};
const OPUS: SensorChoice = {
  sensor: 'claude.opus-4-7',
  maxTokens: 4000,
  maxBudgetUsdMicroPerCall: PREMIUM_PER_CALL,
};
const DEEPSEEK_BATCH: SensorChoice = {
  sensor: 'deepseek.v3',
  maxTokens: 4000,
  maxBudgetUsdMicroPerCall: CHEAP_PER_CALL,
};

const BUILTIN: Readonly<Record<string, BuiltinRoute>> = Object.freeze({
  greeting: {
    chain: [HAIKU, SONNET],
    cognitionMode: 'fast',
    reasoning: 'lightweight pleasantries — Haiku is fast and cheap',
  },
  form_field_help: {
    chain: [HAIKU, SONNET],
    cognitionMode: 'fast',
    reasoning: 'one-line field hints — Haiku-first',
  },
  voice_turn: {
    chain: [SONNET, HAIKU],
    cognitionMode: 'default',
    reasoning: 'conversational latency budget — Sonnet primary',
  },
  explanation: {
    chain: [SONNET, OPUS],
    cognitionMode: 'default',
    reasoning: 'multi-paragraph explanation — Sonnet primary, Opus fallback',
  },
  inspection_summary: {
    chain: [SONNET, OPUS],
    cognitionMode: 'default',
    reasoning: 'property-mgmt inspection digest — Sonnet primary',
  },
  arrears_memo: {
    chain: [OPUS, SONNET],
    cognitionMode: 'deep',
    reasoning: 'high-stakes financial memo — Opus primary, Sonnet fallback',
  },
  compliance_review: {
    chain: [OPUS, SONNET],
    cognitionMode: 'deep',
    reasoning: 'KRA / GePG / certificate logic — Opus primary',
  },
  property_grade_briefing: {
    chain: [OPUS, SONNET],
    cognitionMode: 'deep',
    reasoning: '5-axis grade synthesis — Opus primary',
  },
  bulk_extraction: {
    chain: [DEEPSEEK_BATCH, SONNET],
    cognitionMode: 'default',
    reasoning: 'bulk-throughput batch — DeepSeek primary, Sonnet fallback',
  },
});

const TIER_DOWNGRADE: Readonly<Record<TenantTier, (c: SensorChoice) => SensorChoice>> = Object.freeze({
  free: (c) => (c.sensor === OPUS.sensor ? SONNET : c),
  growth: (c) => c,
  enterprise: (c) => c,
});

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createSensorRoutingService(db: DatabaseClient): SensorRoutingService {
  return {
    async recordSensorCall(args) {
      const id = randomUUID();
      try {
        if (!args.task || !args.sensor) {
          throw new Error('task / sensor are required');
        }
        const tokensIn = Math.max(0, Math.floor(args.tokensIn ?? 0));
        const tokensOut = Math.max(0, Math.floor(args.tokensOut ?? 0));
        const cost = Math.max(0, Math.floor(args.costUsdMicro ?? 0));

        const insertRow: Record<string, unknown> = {
          id,
          tenantId: args.tenantId,
          task: args.task,
          sensor: args.sensor,
          model: args.model ?? args.sensor,
          startedAt: args.startedAt,
          completedAt: args.completedAt ?? null,
          outcome: args.outcome,
          errorClass: args.errorClass ?? null,
          tokensIn,
          tokensOut,
          costUsdMicro: cost,
          latencyMs:
            typeof args.latencyMs === 'number' && Number.isFinite(args.latencyMs)
              ? Math.max(0, Math.floor(args.latencyMs))
              : null,
          thinkingActive: Boolean(args.thinkingActive),
          decisionTraceId: args.decisionTraceId ?? null,
        };

        await db.insert(sensorCallLog).values(insertRow as never);

        // Debit the envelope only when (a) the call cost real dollars,
        // (b) a tenant is on the hook, and (c) the row exists for the
        // current period. We use a SQL `consumed + cost` update so the
        // server arbitrates concurrency rather than this process.
        if (args.tenantId && cost > 0) {
          await db
            .update(tenantBudgetEnvelopes)
            .set({
              consumedUsdMicro: sql`${tenantBudgetEnvelopes.consumedUsdMicro} + ${cost}`,
              updatedAt: new Date(),
            } as never)
            .where(
              and(
                eq(tenantBudgetEnvelopes.tenantId, args.tenantId),
                lt(tenantBudgetEnvelopes.periodStart, args.startedAt),
                gte(tenantBudgetEnvelopes.periodEnd, args.startedAt),
              ),
            );
        }
        return { id };
      } catch (error) {
        logger.error('sensor-routing.recordSensorCall failed', { error: error });
        return { id };
      }
    },

    async getBudgetStatus(args) {
      try {
        if (!args.tenantId) return null;
        const now = args.now ?? new Date();

        const rows = (await db
          .select({
            tenantId: tenantBudgetEnvelopes.tenantId,
            periodStart: tenantBudgetEnvelopes.periodStart,
            periodEnd: tenantBudgetEnvelopes.periodEnd,
            budgetUsdMicro: tenantBudgetEnvelopes.budgetUsdMicro,
            consumedUsdMicro: tenantBudgetEnvelopes.consumedUsdMicro,
            alertThresholdPct: tenantBudgetEnvelopes.alertThresholdPct,
            hardCapEnforced: tenantBudgetEnvelopes.hardCapEnforced,
          })
          .from(tenantBudgetEnvelopes)
          .where(
            and(
              eq(tenantBudgetEnvelopes.tenantId, args.tenantId),
              lt(tenantBudgetEnvelopes.periodStart, now),
              gte(tenantBudgetEnvelopes.periodEnd, now),
            ),
          )
          .limit(1)) as ReadonlyArray<{
          tenantId: string;
          periodStart: Date | string;
          periodEnd: Date | string;
          budgetUsdMicro: number | string;
          consumedUsdMicro: number | string;
          alertThresholdPct: number;
          hardCapEnforced: boolean;
        }>;

        const row = rows[0];
        if (!row) return null;

        const budget = toNumber(row.budgetUsdMicro);
        const consumed = toNumber(row.consumedUsdMicro);
        const remaining = Math.max(0, budget - consumed);
        const utilisation = budget > 0 ? Math.min(1, consumed / budget) : 0;

        return {
          tenantId: row.tenantId,
          periodStart: toDate(row.periodStart),
          periodEnd: toDate(row.periodEnd),
          budgetUsdMicro: budget,
          consumedUsdMicro: consumed,
          remainingUsdMicro: remaining,
          utilisation,
          alertThresholdPct: row.alertThresholdPct,
          hardCapEnforced: row.hardCapEnforced,
        };
      } catch (error) {
        logger.error('sensor-routing.getBudgetStatus failed', { error: error });
        return null;
      }
    },

    selectSensorChain(task, tier) {
      const route = BUILTIN[task];
      if (!route || route.chain.length === 0) {
        return {
          task,
          tenantTier: tier ?? null,
          primary: SONNET,
          fallbacks: [HAIKU],
          cognitionMode: 'default',
          source: 'builtin',
          reasoning: 'no builtin route — defaulting to Sonnet → Haiku',
        };
      }
      const downgrade = tier ? TIER_DOWNGRADE[tier] : (c: SensorChoice) => c;
      const chain = route.chain.map(downgrade);
      const [primary, ...fallbacks] = chain;
      return {
        task,
        tenantTier: tier ?? null,
        primary,
        fallbacks,
        cognitionMode: route.cognitionMode,
        source: 'builtin',
        reasoning: route.reasoning,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}
