/**
 * Inngest-backed durable ScheduleAdapter — production path for
 * `power_tool.schedule`.
 *
 * The kernel's `schedule` power-tool persists a future tool invocation via a
 * `ScheduleAdapter`. The in-memory default (`createInMemoryScheduleAdapter`)
 * fires through a process-local `setTimeout` — lost on restart, fires nothing
 * after a crash. This adapter swaps that for a DURABLE persist: it emits a
 * `POWER_TOOL_SCHEDULED_EVENT` onto Inngest with the scheduledId as the event
 * `id` (Inngest de-dupes by id → at-least-once becomes effectively-once for the
 * scheduling intent). The matching firing function
 * (`inngest-functions/power-tool-scheduled-call.fn.ts`) sleeps until `runAtIso`
 * then re-enters the registry to dispatch the call under the SAME governance +
 * audit chain a live call would hit.
 *
 * IMPORTANT — no delayed-send: `InngestClientLike.send` carries NO `ts`/delay
 * param. The durable delay is implemented inside the firing function via
 * `step.sleepUntil(runAtIso)`, NOT by deferring the send. The send happens
 * immediately; only the dispatch is deferred.
 *
 * HONEST-DEGRADE on send failure: a failed `send` means the schedule was NOT
 * durably persisted. Returning the record anyway would be a silent lie (the
 * caller believes the call is scheduled when nothing will ever fire). So we
 * RETHROW — the schedule power-tool's own try/catch (schedule.ts) converts the
 * throw into a `{ kind: 'failed' }` result, surfacing the failure honestly
 * rather than fabricating a durable persist. This is the opposite of the
 * in-memory adapter's behaviour by design: in-memory cannot fail to enqueue.
 *
 * @module composition/power-tool-schedule-adapter
 */

import { powerTools } from '@borjie/central-intelligence';
import type { InngestClientLike } from './durable/inngest-client.js';

type ScheduleAdapter = powerTools.ScheduleAdapter;
type ScheduledCallRecord = powerTools.ScheduledCallRecord;

/**
 * Inngest event name for a deferred power-tool call. Pinned constant so the
 * adapter (producer), the firing function (consumer) and any diagnostics all
 * agree on a single string — mirrors the `AGENCY_RUN_EVENT` pattern next to it
 * in `inngest-client.ts`.
 */
export const POWER_TOOL_SCHEDULED_EVENT =
  'power-tool/scheduled-call.requested' as const;

/** Narrow logger surface — pino-shaped, no console. Optional methods so a
 *  no-op stub satisfies the contract. */
export interface ScheduleAdapterLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

/** Generate a collision-resistant scheduledId. Mirrors the in-memory
 *  adapter's shape so downstream consumers stay format-agnostic. */
function makeScheduledId(): string {
  return `sched-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/**
 * Build a durable, Inngest-backed `ScheduleAdapter`. The composition root wires
 * this when `isInngestEnabled()` is true; otherwise the registry keeps its
 * in-memory default. Construction is pure (no env reads, no network) — the
 * single network effect is the `send` inside `schedule()`.
 */
export function createInngestScheduleAdapter(
  client: InngestClientLike,
  logger: ScheduleAdapterLogger,
): ScheduleAdapter {
  return {
    async schedule(
      record: Omit<ScheduledCallRecord, 'scheduledId'>,
    ): Promise<ScheduledCallRecord> {
      const scheduledId = makeScheduledId();
      const full: ScheduledCallRecord = { ...record, scheduledId };
      try {
        await client.send({
          name: POWER_TOOL_SCHEDULED_EVENT,
          // Spread the full record so the firing function reconstructs the
          // ctx + dispatches the call from event data alone.
          data: { ...full },
          // Idempotency: Inngest de-dupes by event id, so a retried send of
          // the same scheduling intent enqueues exactly one deferred call.
          id: scheduledId,
        });
      } catch (err) {
        // A failed send = nothing was durably persisted. Surfacing the record
        // would be a silent persist-but-never-fires lie. Rethrow so the
        // schedule power-tool degrades to a `failed` result honestly.
        logger.error?.(
          {
            wiring: 'power-tool-schedule-adapter',
            scheduledId,
            toolName: full.toolName,
            err: err instanceof Error ? err.message : String(err),
          },
          'power-tool-schedule-adapter: durable enqueue failed — schedule NOT persisted',
        );
        throw err instanceof Error ? err : new Error(String(err));
      }
      logger.info?.(
        {
          wiring: 'power-tool-schedule-adapter',
          scheduledId,
          toolName: full.toolName,
          runAtIso: full.runAtIso,
        },
        'power-tool-schedule-adapter: deferred call durably enqueued',
      );
      return full;
    },
  };
}
