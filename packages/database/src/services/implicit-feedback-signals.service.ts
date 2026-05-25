/**
 * Implicit feedback signals — Drizzle-backed service.
 *
 * Records one row per implicit-signal event emitted by the sensorium
 * (C4) or detected by the consolidation worker's stage 01-ingest
 * (re-prompt < 30s, time-to-resolution, abandonment).
 *
 * Reads:
 *   - listByTrace(traceId)         every signal for a kernel turn
 *   - listForUser(tenantId, userId) recent signals across surfaces
 *   - rollupForTenant(tenantId, sinceDays)
 *                                   per-(signal_type, surface) counts
 *                                   + strength-weighted mean — the
 *                                   nightly consolidation reads this
 *                                   to detect drift / opportunity.
 *
 * Hard DB failures degrade: writes log + swallow, reads return [] /
 * zeroed rollups.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { implicitFeedbackSignals } from '../schemas/implicit-feedback-signals.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type ImplicitSignalType =
  | 'copy'
  | 're-prompt'
  | 'edit-resubmit'
  | 'override'
  | 'abandonment'
  | 'time-to-resolution';

export interface ImplicitSignal {
  readonly id: string;
  readonly traceId: string;
  readonly agentActionId: string | null;
  readonly tenantId: string;
  readonly userId: string;
  readonly surface: string;
  readonly signalType: ImplicitSignalType;
  readonly strength: number;
  readonly payload: unknown;
  readonly emittedAt: string;
}

export interface RecordSignalArgs {
  readonly traceId: string;
  readonly agentActionId?: string | null;
  readonly tenantId: string;
  readonly userId: string;
  readonly surface: string;
  readonly signalType: ImplicitSignalType;
  readonly strength: number;
  readonly payload?: unknown;
}

export interface ListByTraceArgs {
  readonly traceId: string;
}

export interface ListForUserArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly limit?: number;
  readonly sinceDays?: number;
}

export interface RollupForTenantArgs {
  readonly tenantId: string;
  readonly sinceDays: number;
}

export interface ImplicitFeedbackRollup {
  /** count per signalType */
  readonly byType: Record<ImplicitSignalType, number>;
  /** count per surface */
  readonly bySurface: Record<string, number>;
  /** strength-weighted average across all rows */
  readonly meanStrength: number;
  readonly totalSignals: number;
}

export interface ImplicitFeedbackSignalsService {
  record(args: RecordSignalArgs): Promise<{ id: string }>;
  listByTrace(args: ListByTraceArgs): Promise<ReadonlyArray<ImplicitSignal>>;
  listForUser(args: ListForUserArgs): Promise<ReadonlyArray<ImplicitSignal>>;
  rollupForTenant(args: RollupForTenantArgs): Promise<ImplicitFeedbackRollup>;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;
const DEFAULT_SINCE_DAYS = 30;
const VALID_SIGNAL_TYPES: ReadonlySet<ImplicitSignalType> = new Set([
  'copy',
  're-prompt',
  'edit-resubmit',
  'override',
  'abandonment',
  'time-to-resolution',
]);

const ZERO_ROLLUP: ImplicitFeedbackRollup = {
  byType: {
    copy: 0,
    're-prompt': 0,
    'edit-resubmit': 0,
    override: 0,
    abandonment: 0,
    'time-to-resolution': 0,
  },
  bySurface: {},
  meanStrength: 0,
  totalSignals: 0,
};

export function createImplicitFeedbackSignalsService(
  db: DatabaseClient,
): ImplicitFeedbackSignalsService {
  return {
    async record(args) {
      const id = randomUUID();
      try {
        if (!args.traceId || !args.tenantId || !args.userId) {
          throw new Error(
            'traceId / tenantId / userId are required for implicit signal',
          );
        }
        if (!VALID_SIGNAL_TYPES.has(args.signalType)) {
          throw new Error(`unknown implicit signal type: ${args.signalType}`);
        }
        const surface = (args.surface ?? '').slice(0, 64).trim();
        if (!surface) {
          throw new Error('surface is required for implicit signal');
        }
        const strength = clamp01(args.strength);

        await db.insert(implicitFeedbackSignals).values({
          id,
          traceId: args.traceId,
          agentActionId: args.agentActionId ?? null,
          tenantId: args.tenantId,
          userId: args.userId,
          surface,
          signalType: args.signalType,
          strength,
          payloadJson: (args.payload ?? {}) as never,
        } as never);

        return { id };
      } catch (error) {
        logger.error('implicit-feedback.record failed', { error: error });
        return { id };
      }
    },

    async listByTrace(args) {
      try {
        if (!args.traceId) return [];
        const rows = (await db
          .select(SELECT_COLS)
          .from(implicitFeedbackSignals)
          .where(eq(implicitFeedbackSignals.traceId, args.traceId))
          .orderBy(desc(implicitFeedbackSignals.emittedAt))) as ReadonlyArray<SignalRow>;
        return (rows ?? []).map(rowToSignal);
      } catch (error) {
        logger.error('implicit-feedback.listByTrace failed', { error: error });
        return [];
      }
    },

    async listForUser(args) {
      try {
        if (!args.tenantId || !args.userId) return [];
        const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT);
        const sinceDays = clampSinceDays(args.sinceDays, DEFAULT_SINCE_DAYS);
        const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

        const rows = (await db
          .select(SELECT_COLS)
          .from(implicitFeedbackSignals)
          .where(
            and(
              eq(implicitFeedbackSignals.tenantId, args.tenantId),
              eq(implicitFeedbackSignals.userId, args.userId),
              gte(implicitFeedbackSignals.emittedAt, cutoff),
            ),
          )
          .orderBy(desc(implicitFeedbackSignals.emittedAt))
          .limit(limit)) as ReadonlyArray<SignalRow>;

        return (rows ?? []).map(rowToSignal);
      } catch (error) {
        logger.error('implicit-feedback.listForUser failed', { error: error });
        return [];
      }
    },

    async rollupForTenant(args) {
      try {
        if (!args.tenantId) return ZERO_ROLLUP;
        const sinceDays = clampSinceDays(args.sinceDays, DEFAULT_SINCE_DAYS);
        const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

        const rows = (await db
          .select({
            signalType: implicitFeedbackSignals.signalType,
            surface: implicitFeedbackSignals.surface,
            strength: implicitFeedbackSignals.strength,
          })
          .from(implicitFeedbackSignals)
          .where(
            and(
              eq(implicitFeedbackSignals.tenantId, args.tenantId),
              gte(implicitFeedbackSignals.emittedAt, cutoff),
            ),
          )) as ReadonlyArray<{
          signalType: string;
          surface: string;
          strength: number;
        }>;

        const byType: Record<string, number> = { ...ZERO_ROLLUP.byType };
        const bySurface: Record<string, number> = {};
        let strengthSum = 0;
        let totalSignals = 0;
        for (const row of rows ?? []) {
          totalSignals += 1;
          strengthSum += Number(row.strength ?? 0);
          if (VALID_SIGNAL_TYPES.has(row.signalType as ImplicitSignalType)) {
            byType[row.signalType] = (byType[row.signalType] ?? 0) + 1;
          }
          if (row.surface) {
            bySurface[row.surface] = (bySurface[row.surface] ?? 0) + 1;
          }
        }
        const meanStrength = totalSignals > 0 ? strengthSum / totalSignals : 0;
        return {
          byType: byType as ImplicitFeedbackRollup['byType'],
          bySurface,
          meanStrength,
          totalSignals,
        };
      } catch (error) {
        logger.error('implicit-feedback.rollupForTenant failed', { error: error });
        return ZERO_ROLLUP;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: implicitFeedbackSignals.id,
  traceId: implicitFeedbackSignals.traceId,
  agentActionId: implicitFeedbackSignals.agentActionId,
  tenantId: implicitFeedbackSignals.tenantId,
  userId: implicitFeedbackSignals.userId,
  surface: implicitFeedbackSignals.surface,
  signalType: implicitFeedbackSignals.signalType,
  strength: implicitFeedbackSignals.strength,
  payloadJson: implicitFeedbackSignals.payloadJson,
  emittedAt: implicitFeedbackSignals.emittedAt,
} as const;

interface SignalRow {
  id: string;
  traceId: string;
  agentActionId: string | null;
  tenantId: string;
  userId: string;
  surface: string;
  signalType: string;
  strength: number;
  payloadJson: unknown;
  emittedAt: Date | string;
}

function rowToSignal(row: SignalRow): ImplicitSignal {
  return {
    id: row.id,
    traceId: row.traceId,
    agentActionId: row.agentActionId,
    tenantId: row.tenantId,
    userId: row.userId,
    surface: row.surface,
    signalType: normaliseSignal(row.signalType),
    strength: Number(row.strength ?? 0),
    payload: row.payloadJson ?? {},
    emittedAt:
      row.emittedAt instanceof Date
        ? row.emittedAt.toISOString()
        : String(row.emittedAt),
  };
}

function normaliseSignal(s: string): ImplicitSignalType {
  if (VALID_SIGNAL_TYPES.has(s as ImplicitSignalType)) {
    return s as ImplicitSignalType;
  }
  return 'abandonment';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_LIST_LIMIT);
}

function clampSinceDays(
  input: number | undefined,
  fallback: number,
): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), 365);
}

export { implicitFeedbackSignals };
