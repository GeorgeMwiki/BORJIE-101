/**
 * power_tool.schedule — schedule a deferred kernel call.
 *
 * The agent persists a future tool invocation. A background processor
 * (Inngest binding in prod, plain setTimeout in dev / unit tests) picks
 * up the row when its `runAt` arrives and dispatches the call through
 * the standard kernel-tool registry.
 *
 * Two backends are pluggable:
 *
 *   - Inngest adapter — prod path. Emits a queued event.
 *   - setTimeout adapter — dev / unit-test path. Fires in-process.
 *
 * The composition root at the api-gateway selects the right adapter;
 * if no adapter is supplied the tool refuses with `NOT_IMPLEMENTED`.
 *
 * Tier model:
 *   - requiredTier: estate-manager. Residents do not schedule deferred
 *     mutations; owners can express scheduling intent but it is the
 *     estate-manager-tier persona that the orchestrator binds the
 *     deferred call to.
 *
 * Approval: none for scheduling itself. The DISPATCHED tool the cron
 * fires may carry its own approval requirement and the executor
 * re-checks it at fire-time (no privilege laundering through the cron).
 *
 * Audit trail: `audit_events` row at schedule-time. The dispatched call
 * lands its own row at fire-time through the normal tool pipeline.
 *
 * @module kernel/power-tools/schedule
 */

import { z } from 'zod';
import type {
  PowerTool,
  PowerToolContext,
  PowerToolResult,
} from './types.js';

const MAX_ATTEMPTS_CEILING = 10;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RUN_AT_HORIZON_DAYS = 365;

// ─────────────────────────────────────────────────────────────────────
// Adapter port
// ─────────────────────────────────────────────────────────────────────

export interface ScheduledCallRecord {
  readonly scheduledId: string;
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly runAtIso: string;
  readonly maxAttempts: number;
  readonly originalCallerId: string;
  readonly originalTier: PowerToolContext['tier'];
  readonly tenantId: string | null;
  readonly threadId: string;
}

export interface ScheduleAdapter {
  schedule(record: Omit<ScheduledCallRecord, 'scheduledId'>): Promise<ScheduledCallRecord>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory setTimeout adapter — dev + unit-test path.
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryScheduleAdapter extends ScheduleAdapter {
  readonly records: ReadonlyArray<ScheduledCallRecord>;
  /** Cancel every pending setTimeout. Tests call this in afterEach. */
  cancelAll(): void;
}

export function createInMemoryScheduleAdapter(
  dispatcher: (record: ScheduledCallRecord) => Promise<void> | void = async () => {},
): InMemoryScheduleAdapter {
  const records: ScheduledCallRecord[] = [];
  const timers: NodeJS.Timeout[] = [];
  return {
    async schedule(
      args: Omit<ScheduledCallRecord, 'scheduledId'>,
    ): Promise<ScheduledCallRecord> {
      const scheduledId = `sched-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      const record: ScheduledCallRecord = { ...args, scheduledId };
      records.push(record);
      const delayMs = Math.max(0, new Date(record.runAtIso).getTime() - Date.now());
      const timer = setTimeout(() => {
        void Promise.resolve(dispatcher(record)).catch(() => {});
      }, delayMs);
      timers.push(timer);
      return record;
    },
    get records(): ReadonlyArray<ScheduledCallRecord> {
      return records;
    },
    cancelAll(): void {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

export const ScheduleSchema = z.object({
  /** Name of the tool to dispatch when runAt arrives. */
  toolName: z.string().min(1),
  /** Opaque args object — validated at fire-time by the dispatched tool. */
  toolArgs: z.record(z.unknown()),
  /** ISO 8601 timestamp. Must be strictly in the future. */
  runAtIso: z.string().datetime(),
  /** Retry budget. Clamped 1..10. */
  maxAttempts: z.number().int().positive().max(MAX_ATTEMPTS_CEILING).optional(),
});

export type ScheduleArgs = z.infer<typeof ScheduleSchema>;

export interface ScheduleOutput {
  readonly action: 'schedule';
  readonly scheduledId: string;
  readonly toolName: string;
  readonly runAtIso: string;
  readonly maxAttempts: number;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createSchedulePowerTool(
  adapter: ScheduleAdapter | null,
): PowerTool<ScheduleArgs, ScheduleOutput> {
  return {
    id: 'schedule',
    name: 'Schedule deferred call',
    description:
      'Schedule a future tool call. A background processor fires the call when runAt arrives. Inngest-backed in prod; in-memory setTimeout in dev.',
    requiredTier: 'estate-manager',
    requiresApproval: false,
    auditDestination: 'audit-events',
    schema: ScheduleSchema,
    async execute(
      ctx: PowerToolContext,
      args: ScheduleArgs,
    ): Promise<PowerToolResult<ScheduleOutput>> {
      if (!adapter) {
        return {
          kind: 'refused',
          reasonCode: 'NOT_IMPLEMENTED',
          message:
            'No schedule adapter is wired. Bind an Inngest or in-memory ScheduleAdapter at composition root.',
        };
      }
      // Forbid recursive self-scheduling.
      if (args.toolName === 'power_tool.schedule') {
        return {
          kind: 'refused',
          reasonCode: 'OUT_OF_SCOPE',
          message: 'cannot recursively schedule power_tool.schedule',
        };
      }
      const runAt = new Date(args.runAtIso);
      const now = ctx.clock().getTime();
      if (runAt.getTime() <= now) {
        return {
          kind: 'failed',
          message: 'runAtIso must be strictly in the future',
        };
      }
      const horizonMs = MAX_RUN_AT_HORIZON_DAYS * 24 * 60 * 60 * 1000;
      if (runAt.getTime() - now > horizonMs) {
        return {
          kind: 'failed',
          message: `runAtIso cannot be more than ${MAX_RUN_AT_HORIZON_DAYS} days in the future`,
        };
      }
      const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

      try {
        const record = await adapter.schedule({
          toolName: args.toolName,
          toolArgs: args.toolArgs,
          runAtIso: runAt.toISOString(),
          maxAttempts,
          originalCallerId: ctx.callerId,
          originalTier: ctx.tier,
          tenantId: ctx.tenantId,
          threadId: ctx.threadId,
        });
        return {
          kind: 'ok',
          output: {
            action: 'schedule',
            scheduledId: record.scheduledId,
            toolName: record.toolName,
            runAtIso: record.runAtIso,
            maxAttempts: record.maxAttempts,
          },
        };
      } catch (err) {
        return {
          kind: 'failed',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
