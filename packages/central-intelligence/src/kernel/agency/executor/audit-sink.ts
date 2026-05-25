/**
 * Agency — action audit sink.
 *
 * Every step transition (running, done, failed, awaiting-approval) is
 * recorded so an operator can replay why the brain did what it did.
 * The sink is provider-agnostic; the Drizzle adapter lives in
 * `@borjie/database` (`createKernelActionAuditService`).
 */
import { createHash } from 'crypto';

export type ActionAuditDecision =
  | 'running'
  | 'done'
  | 'failed'
  | 'awaiting-approval'
  | 'skipped'
  | 'unknown-tool';

export interface ActionAuditEntry {
  readonly tenantId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly stepId: string;
  readonly toolName: string | null;
  readonly decision: ActionAuditDecision;
  readonly payloadHash: string;
  readonly outcome: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly latencyMs: number | null;
}

export interface ActionAuditSink {
  record(entry: ActionAuditEntry): Promise<void>;
}

export function hashPayload(
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return createHash('sha256').update('null', 'utf8').digest('hex');
  let canonical: string;
  try {
    canonical = JSON.stringify(payload, Object.keys(payload).sort());
  } catch {
    canonical = String(payload);
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * In-memory audit sink for tests / dev. Captures every entry into a
 * read-only array; the test reads `entries` to assert transitions.
 */
export interface InMemoryActionAuditSink extends ActionAuditSink {
  readonly entries: ReadonlyArray<ActionAuditEntry>;
}

export function createInMemoryActionAuditSink(): InMemoryActionAuditSink {
  const entries: ActionAuditEntry[] = [];
  const sink: InMemoryActionAuditSink = {
    async record(entry) {
      entries.push(entry);
    },
    get entries(): ReadonlyArray<ActionAuditEntry> {
      return entries;
    },
  };
  return sink;
}
