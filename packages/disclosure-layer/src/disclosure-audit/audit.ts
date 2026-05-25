/**
 * `logDisclosure` — append-only disclosure audit emitter.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §6
 */

import { randomUUID } from 'node:crypto';

import {
  type DisclosureAuditEvent,
  type DisclosureAuditQuery,
  type DisclosureAuditSink,
  type LogDisclosureInput,
} from './types.js';

/**
 * Construct an audit event from the input. Pure — no I/O.
 *
 * Returns a frozen, deeply-immutable record. The composer hands this
 * to a `DisclosureAuditSink.log` for shipping to the J1 entity store.
 */
export function buildDisclosureEvent(
  input: LogDisclosureInput,
  now: number = Date.now()
): DisclosureAuditEvent {
  return Object.freeze({
    id: `disc-${randomUUID()}`,
    ts: new Date(now).toISOString(),
    principalId: input.principalId,
    principalRole: input.principalRole,
    principalTier: input.principalTier,
    query: input.query,
    fieldsReturned: Object.freeze([...input.fieldsReturned]),
    refusedFields: Object.freeze([...input.refusedFields]),
    ...(input.refusalCategory !== undefined ? { refusalCategory: input.refusalCategory } : {}),
    canaryLeakDetected: input.canaryLeakDetected ?? false,
    ...(input.euAct50EmittedSurface !== undefined
      ? { euAct50EmittedSurface: input.euAct50EmittedSurface }
      : {}),
  });
}

/**
 * Emit a disclosure event to the provided sink.
 */
export async function logDisclosure(
  sink: DisclosureAuditSink,
  input: LogDisclosureInput,
  now: number = Date.now()
): Promise<DisclosureAuditEvent> {
  const event = buildDisclosureEvent(input, now);
  await sink.log(event);
  return event;
}

/**
 * Default in-memory sink for tests and local development.
 *
 * Append-only — `log` does not mutate prior events; `query` returns a
 * NEW frozen array each call.
 */
export class InMemoryDisclosureAuditSink implements DisclosureAuditSink {
  // Array kept private; each `log` produces a NEW array via spread.
  // Append-only semantics: nothing ever overwrites or deletes.
  private events: ReadonlyArray<DisclosureAuditEvent> = Object.freeze([]);

  log(event: DisclosureAuditEvent): void {
    this.events = Object.freeze([...this.events, event]);
  }

  query(filter: DisclosureAuditQuery = {}): readonly DisclosureAuditEvent[] {
    return Object.freeze(
      this.events.filter((e) => {
        if (filter.principalId !== undefined && e.principalId !== filter.principalId) return false;
        if (filter.principalRole !== undefined && e.principalRole !== filter.principalRole) return false;
        if (filter.canaryLeakDetected !== undefined && e.canaryLeakDetected !== filter.canaryLeakDetected) {
          return false;
        }
        if (filter.refusalCategory !== undefined && e.refusalCategory !== filter.refusalCategory) {
          return false;
        }
        if (filter.fieldName !== undefined) {
          const present =
            e.fieldsReturned.includes(filter.fieldName) || e.refusedFields.includes(filter.fieldName);
          if (!present) return false;
        }
        if (filter.tsFrom !== undefined && Date.parse(e.ts) < filter.tsFrom) return false;
        if (filter.tsTo !== undefined && Date.parse(e.ts) >= filter.tsTo) return false;
        return true;
      })
    );
  }

  /** Count for tests. */
  size(): number {
    return this.events.length;
  }
}
