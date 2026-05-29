/**
 * Persona-tool audit sink (companion to loopback-http-client.ts).
 *
 * Closes the gap documented in `Docs/AUDIT/REALITY_CHECK_2026-05-29.md` G-D:
 *
 *   "Same code site as G-A: `personaGate` has no `auditSink`. Any persona-
 *    tool WRITE call would skip the audit-chain append. After G-A's
 *    httpClient fix lands, this becomes the next missing pillar."
 *
 * Why structured-log backed and not direct DB writes:
 *
 *   1. The persona-tool catalog dispatches across 16+ domains. Each
 *      domain's WRITE route already appends to its own canonical audit
 *      trail via the recorder it owns (decision-journal, ai_audit_chain,
 *      ledger, etc). The persona-tool gate's `auditSink` is a SECOND
 *      layer of observability — "what tool did the brain decide to call,
 *      with what stakes, with what outcome" — not a duplicate of the
 *      per-domain audit ledger.
 *
 *   2. A direct DB append from the gate would couple the persona-tool
 *      kernel to the database. Keeping it structured-log-backed means
 *      the kernel stays composable (tests can substitute the in-memory
 *      collector below; SREs can grep / aggregate via Pino's standard
 *      transport).
 *
 *   3. Every audit entry carries `outcome`, `stakes`, `personaSlug` so
 *      downstream alerting can fire on `outcome=denied` rate spikes
 *      without needing a join across tenant tables.
 *
 * Two implementations are exported:
 *
 *   - `createPinoAuditSink(logger)` — production sink.
 *   - `createInMemoryAuditSink()` — test seam.
 */

import type {
  PersonaToolAuditEntry,
  PersonaToolAuditSink,
} from './types';

interface PinoLogger {
  info(ctx: object, message?: string): void;
}

/**
 * Production sink. Emits one structured info log per WRITE-tool call so
 * the entry is searchable in the standard Pino pipeline.
 *
 * The `tool.persona_audit` event name is reserved for this sink — alerts
 * key on it.
 */
export function createPinoAuditSink(logger: PinoLogger): PersonaToolAuditSink {
  return {
    async append(entry: PersonaToolAuditEntry): Promise<void> {
      logger.info(
        {
          event: 'tool.persona_audit',
          toolId: entry.toolId,
          tenantId: entry.tenantId,
          actorId: entry.actorId,
          personaSlug: entry.personaSlug,
          stakes: entry.stakes,
          inputDigest: entry.inputDigest,
          outcome: entry.outcome,
          occurredAt: entry.occurredAt,
        },
        'persona-tool audit',
      );
    },
  };
}

/**
 * Test sink — collects every append into an array for assertions.
 */
export interface InMemoryAuditSink extends PersonaToolAuditSink {
  readonly entries: ReadonlyArray<PersonaToolAuditEntry>;
}

export function createInMemoryAuditSink(): InMemoryAuditSink {
  const buf: PersonaToolAuditEntry[] = [];
  return {
    get entries(): ReadonlyArray<PersonaToolAuditEntry> {
      return buf;
    },
    async append(entry: PersonaToolAuditEntry): Promise<void> {
      buf.push(entry);
    },
  };
}
