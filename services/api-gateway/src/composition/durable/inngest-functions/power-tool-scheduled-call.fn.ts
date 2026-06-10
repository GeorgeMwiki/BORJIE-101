/**
 * power-tool-scheduled-call.fn — Inngest function that FIRES a deferred
 * `power_tool.schedule` call when its `runAt` arrives.
 *
 * Mirrors `agency-run.fn.ts` exactly: a dynamic `client.createFunction`
 * factory that returns `null` when `createFunction` is absent (test stubs /
 * CI baseline before the `inngest` dep installs), so registration silently
 * no-ops in those environments.
 *
 * Lifecycle of one deferred call:
 *
 *   1. The durable adapter (`power-tool-schedule-adapter.ts`) emits
 *      `POWER_TOOL_SCHEDULED_EVENT` with the full `ScheduledCallRecord` in
 *      `event.data` the moment `power_tool.schedule` runs.
 *   2. THIS function triggers on that event and, inside the handler:
 *        a. `step.sleepUntil('wait-until-runat', runAtIso)` — Inngest holds
 *           the run durably until `runAt` (NO process-local timer; survives
 *           restarts). This is why the adapter does an immediate send rather
 *           than a delayed one.
 *        b. `step.run('dispatch', …)` re-enters `registry.invoke(toolName,
 *           toolArgs, ctx)` where `ctx` is REBUILT from the event data — the
 *           original tenant / tier / caller / thread — WITH the real
 *           hash-chained audit sink. The fired call is therefore governed +
 *           audited byte-for-byte like a live call: the registry re-applies
 *           the tier gate, approval gate, schema validation, and audit-row
 *           emission. No privilege laundering through the cron.
 *
 * Recursion guard: refuses to dispatch `power_tool.schedule` or
 * `power_tool.compose` (and their bare `schedule`/`compose` ids) — a deferred
 * call must not schedule another deferred call nor open a transactional
 * sub-chain from inside the cron. This mirrors `schedule.ts`'s own
 * self-scheduling refusal.
 *
 * @module composition/durable/inngest-functions/power-tool-scheduled-call.fn
 */

import { powerTools } from '@borjie/central-intelligence';
import {
  POWER_TOOL_SCHEDULED_EVENT,
  type ScheduleAdapterLogger,
} from '../../power-tool-schedule-adapter.js';
import { createPowerToolAuditSink } from '../../power-tool-audit-sink.js';
import type { InngestFunctionLike } from './agency-run.fn.js';
import type { InngestClientLike } from '../inngest-client.js';

type PowerToolRegistry = powerTools.PowerToolRegistry;
type PowerToolContext = powerTools.PowerToolContext;
type PowerToolTier = powerTools.PowerToolTier;

/** Event payload shape — the full `ScheduledCallRecord` the adapter spread
 *  into `event.data`. Validated structurally at fire-time (the producer is
 *  trusted, but the values arrive across a serialisation boundary). */
export interface PowerToolScheduledCallEventData {
  readonly scheduledId: string;
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly runAtIso: string;
  readonly maxAttempts: number;
  readonly originalCallerId: string;
  readonly originalTier: PowerToolTier;
  readonly tenantId: string | null;
  readonly threadId: string;
}

/** Tool ids a deferred call must NEVER fire — recursion / sub-chaining guard. */
const FORBIDDEN_FIRE_IDS: ReadonlySet<string> = new Set([
  'schedule',
  'power_tool.schedule',
  'compose',
  'power_tool.compose',
]);

/** Factory deps. The runtime supplies the SAME registry the live route uses
 *  (so the fired call hits the identical inventory) and the db handle the
 *  audit sink is rebuilt from. */
export interface PowerToolScheduledCallFunctionDeps {
  /** Inngest client (real or stub). `createFunction` is pulled off it. */
  readonly client: InngestClientLike & {
    createFunction?: (
      cfg: unknown,
      trigger: unknown,
      handler: unknown,
    ) => InngestFunctionLike;
  };
  /** The power-tool registry the fired call dispatches against. */
  readonly registry: PowerToolRegistry;
  /** Db handle the hash-chained audit sink is rebuilt from. `null` ⇒ the
   *  sink is null and the registry's `emitAudit` short-circuits (degraded). */
  readonly db: unknown;
  /** Logger — pino-shaped. */
  readonly logger: ScheduleAdapterLogger;
}

/** Narrow Inngest step surface the handler needs — `sleepUntil` + `run`. */
interface ScheduledCallStep {
  sleepUntil(id: string, until: string): Promise<void>;
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

/** Rebuild the `PowerToolContext` from event data + the real audit sink. The
 *  fired call is governed exactly like a live call: identity comes from the
 *  persisted record (NEVER from anything the LLM could influence at fire
 *  time), and the audit sink lands the row on the hash-chained trail. */
function rebuildContext(
  data: PowerToolScheduledCallEventData,
  db: unknown,
  logger: ScheduleAdapterLogger,
): PowerToolContext {
  return {
    callerId: data.originalCallerId,
    tier: data.originalTier,
    tenantId: data.tenantId,
    threadId: data.threadId,
    // Deferred dispatch never carries a fresh four-eye approval; the fired
    // tool re-checks its own approval requirement at execute-time.
    approvalRecordId: null,
    auditSink: createPowerToolAuditSink(db, logger),
    clock: () => new Date(),
  };
}

/**
 * Create the `power-tool/scheduled-call.requested` Inngest function. Returns
 * `null` when the client can't make functions (test stubs / dep absent) —
 * mirrors `createAgencyRunFunction`.
 */
export function createPowerToolScheduledCallFunction(
  deps: PowerToolScheduledCallFunctionDeps,
): InngestFunctionLike | null {
  const { client, registry, db, logger } = deps;
  if (typeof client.createFunction !== 'function') return null;

  const handler = async (ctx: {
    readonly event: { readonly data: PowerToolScheduledCallEventData };
    readonly step: ScheduledCallStep;
  }): Promise<{ readonly dispatched: boolean; readonly reason?: string }> => {
    const data = ctx.event.data;

    if (FORBIDDEN_FIRE_IDS.has(data.toolName)) {
      logger.warn?.(
        {
          wiring: 'power-tool-scheduled-call',
          scheduledId: data.scheduledId,
          toolName: data.toolName,
        },
        'power-tool-scheduled-call: refusing to fire a recursive schedule/compose',
      );
      return { dispatched: false, reason: 'recursive-dispatch-refused' };
    }

    // Durable wait — Inngest holds the run until runAt (survives restarts).
    await ctx.step.sleepUntil('wait-until-runat', data.runAtIso);

    // Re-enter the registry under the rebuilt, governed context.
    await ctx.step.run('dispatch', async () => {
      const toolCtx = rebuildContext(data, db, logger);
      return registry.invoke(data.toolName, data.toolArgs, toolCtx);
    });

    logger.info?.(
      {
        wiring: 'power-tool-scheduled-call',
        scheduledId: data.scheduledId,
        toolName: data.toolName,
      },
      'power-tool-scheduled-call: deferred call dispatched at runAt',
    );
    return { dispatched: true };
  };

  return client.createFunction(
    {
      id: 'power-tool-scheduled-call',
      name: 'BORJIE — power-tool scheduled call (durable)',
      retries: 4,
    },
    { event: POWER_TOOL_SCHEDULED_EVENT },
    handler,
  );
}
