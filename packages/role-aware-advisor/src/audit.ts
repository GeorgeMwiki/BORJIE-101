/**
 * Audit trail for the universal-advisor.
 *
 * Every `advise()` call writes one entry to the worm audit store. The
 * entry is intentionally verbose — auditors prefer one rich row over
 * five lean ones, and the storage cost is negligible vs the legal
 * surface (SOC 2 CC7.2, GDPR Art. 30).
 *
 * The store interface here is the minimal subset of
 * `WormAuditStore.append()` from
 * `services/api-gateway/src/composition/persistent-stores-wiring.ts` —
 * we keep it structural so the caller can pass either the persistent
 * Drizzle adapter or an in-memory test double.
 */

import type { Role } from './roles.js';
import type { Intent } from './router.js';

export interface AuditEntry {
  readonly at: string;
  readonly action: 'advisor.ask' | 'advisor.feedback' | 'advisor.starting-points';
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
  readonly sessionId: string | null;
  readonly intent?: Intent;
  readonly question?: string;
  /** A short hash of the answer for grep / dedup — not the answer itself. */
  readonly answerDigest?: string;
  readonly answerId?: string;
  readonly redactedFields: ReadonlyArray<string>;
  readonly deniedSnippetIds: ReadonlyArray<string>;
  readonly latencyMs?: number;
  readonly outcome: 'ok' | 'denied' | 'rate-limited' | 'error';
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface AuditPort {
  append(entry: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/**
 * Append a typed AuditEntry. The store's `append` accepts the wider
 * `Record<string, unknown>` shape so we cast on the way in but keep
 * the typed interface for in-package callers.
 */
export async function recordAudit(
  store: AuditPort,
  entry: AuditEntry,
): Promise<void> {
  await store.append({ ...entry } as Readonly<Record<string, unknown>>);
}

/**
 * Cheap, non-cryptographic 32-bit FNV-1a over a string. Used for the
 * `answerDigest` field — we just need a short stable identifier for
 * grep + dedup, not a security primitive.
 */
export function digestString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * In-memory audit port — bundled here so tests + dev can opt into it
 * without spinning up Postgres. NOT for production; pin to the
 * persistent worm store via the composition root.
 */
export function createInMemoryAuditPort(): AuditPort & {
  readonly entries: ReadonlyArray<Readonly<Record<string, unknown>>>;
} {
  const entries: Array<Readonly<Record<string, unknown>>> = [];
  return {
    async append(entry) {
      entries.push(entry);
      return { id: `mem-audit-${entries.length}` };
    },
    get entries() {
      return entries as ReadonlyArray<Readonly<Record<string, unknown>>>;
    },
  };
}
