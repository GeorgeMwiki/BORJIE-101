/**
 * Cross-portal killswitch fan-out publisher (Central Command Phase C — C2).
 *
 * Implements B1 wiring #2: the platform `killswitch-write.service.ts` adapter
 * accepts an optional `publishCrossPortalEvent` callback; this module
 * provides the concrete wiring that bridges that callback onto the
 * composition-root `CrossPortalBus`. When a HQ operator flips the
 * killswitch (live → degraded → halt or back) the underlying DB row is
 * updated AND every running brain instance learns about it via the
 * shared global topic.
 *
 * Design notes:
 *
 *   - The bus is held as `Promise<CrossPortalBus>` because the Redis
 *     factory lazy-imports `ioredis`. We `await` it once on first
 *     publish; subsequent publishes reuse the resolved value. If the
 *     promise rejects (rare — should only happen if the gateway boot
 *     itself is unhealthy), we log + swallow so the killswitch write
 *     still succeeds.
 *
 *   - Publish failures NEVER throw. The DB row is the source of truth;
 *     cross-portal fan-out is best-effort. A failed publish surfaces as
 *     a structured warning the operator can inspect after the fact.
 *
 *   - Payload shape matches `CrossPortalEventShape` (see
 *     `cross-portal-bus.ts`) — `kind: 'state-mutation'`, `payload` is
 *     the killswitch event itself, `emittedBy` is hard-coded to
 *     `'hq:killswitch'` because the actor id is already inside the
 *     payload (and the bus payload's `emittedBy` is intentionally
 *     coarse — it identifies the EMITTER, not the originating user).
 *
 *   - `emittedAt` is generated at publish time, not derived from the
 *     event's `setAt` — the two timestamps are intentionally distinct
 *     so a delayed publish is still visible as such.
 */

import {
  globalTopic,
  type CrossPortalBus,
} from './cross-portal-bus.js';

// ─────────────────────────────────────────────────────────────────────
// Port shapes — mirrored from
// `packages/database/src/services/platform/killswitch-write.service.ts`
// so this file never compile-depends on the database package.
// ─────────────────────────────────────────────────────────────────────

export type KillswitchEventLevel = 'live' | 'degraded' | 'halt';

export interface KillswitchEvent {
  readonly type: 'killswitch:changed';
  readonly scope: 'platform' | `tenant:${string}`;
  readonly level: KillswitchEventLevel;
  readonly reasonCode: string;
  readonly setAt: string;
}

export type KillswitchFanoutPublisher = (
  event: KillswitchEvent,
) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────
// Logger contract — same minimal shape used elsewhere in the
// composition root. All fields are optional; the publisher swallows
// every failure but logs through this port when supplied so an
// operator can diagnose silent fan-out failures.
// ─────────────────────────────────────────────────────────────────────

export interface KillswitchFanoutLogger {
  readonly info?: (meta: Record<string, unknown>, msg: string) => void;
  readonly warn?: (meta: Record<string, unknown>, msg: string) => void;
}

export interface CreateKillswitchFanoutPublisherDeps {
  /**
   * Cross-portal bus — held as a `Promise` because the Redis-backed
   * factory lazy-imports `ioredis`. We await once and cache the
   * resolved bus so every subsequent publish skips the promise wait.
   */
  readonly crossPortalBus: Promise<CrossPortalBus>;
  readonly logger?: KillswitchFanoutLogger;
  /** Override clock — tests pin a deterministic `emittedAt`. */
  readonly clock?: () => Date;
}

/**
 * Build the per-event publisher. Returns an async function suitable
 * for direct injection into B1's `KillswitchDeps.publishCrossPortalEvent`
 * slot.
 *
 * The returned publisher:
 *   1. Awaits the bus on first use; reuses the resolved value thereafter.
 *   2. Publishes a `state-mutation` event to `globalTopic()` with the
 *      killswitch event as payload.
 *   3. Swallows + logs any failure (bus rejection, publish error). The
 *      killswitch DB write must succeed even if fan-out fails.
 */
export function createKillswitchFanoutPublisher(
  deps: CreateKillswitchFanoutPublisherDeps,
): KillswitchFanoutPublisher {
  const clock = deps.clock ?? (() => new Date());
  // Cache the resolved bus so we only await once. We capture the
  // promise (not the resolved value) up-front so concurrent first
  // calls all queue on the same in-flight resolution.
  let resolvedBusPromise: Promise<CrossPortalBus | null> | null = null;

  function resolveBusOnce(): Promise<CrossPortalBus | null> {
    if (resolvedBusPromise) return resolvedBusPromise;
    resolvedBusPromise = deps.crossPortalBus
      .then((bus) => bus)
      .catch((err: unknown) => {
        deps.logger?.warn?.(
          {
            err: err instanceof Error ? err.message : String(err),
            wiring: 'cross-portal-killswitch-fanout',
          },
          'killswitch-fanout: cross-portal bus failed to resolve — fan-out disabled',
        );
        return null;
      });
    return resolvedBusPromise;
  }

  return async function publish(event: KillswitchEvent): Promise<void> {
    if (!event || typeof event !== 'object') {
      deps.logger?.warn?.(
        { wiring: 'cross-portal-killswitch-fanout' },
        'killswitch-fanout: ignoring null/non-object event',
      );
      return;
    }
    const bus = await resolveBusOnce();
    if (!bus) {
      // Already logged by resolveBusOnce on first failure; subsequent
      // calls silently no-op so we don't spam.
      return;
    }
    try {
      await bus.publish(globalTopic(), {
        kind: 'state-mutation',
        payload: {
          type: event.type,
          scope: event.scope,
          level: event.level,
          reasonCode: event.reasonCode,
          setAt: event.setAt,
        },
        emittedBy: 'hq:killswitch',
        emittedAt: clock().toISOString(),
      });
    } catch (err) {
      deps.logger?.warn?.(
        {
          err: err instanceof Error ? err.message : String(err),
          scope: event.scope,
          level: event.level,
          wiring: 'cross-portal-killswitch-fanout',
        },
        'killswitch-fanout: publish failed — DB write is source of truth, fan-out skipped',
      );
    }
  };
}
