/**
 * WORM (write-once-read-many) audit log for generated documents.
 *
 * Every document that leaves `@borjie/document-studio` writes one
 * append-only audit entry: who, what, when, sha256 of the rendered
 * bytes, sha256 of the citation set, sha256 of the prior entry.
 *
 * Pure + dependency-injected store. The in-memory store here is for
 * dev/tests; production wires a Drizzle-backed adapter that satisfies
 * the same `WormAuditStore` port.
 */

import { sha256Hex } from '../citations/citation-verifier.js';
import type { Citation } from '../citations/citation-verifier.js';

export interface WormAuditEntry {
  readonly entryId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly documentKind: string; // 'monthly-owner-report' | 'eviction-notice' | ...
  readonly documentId: string;
  readonly renderedAtIso: string;
  readonly renderedSha256: string;
  readonly citationsSha256: string;
  readonly previousEntryHash: string | null;
  readonly chainHash: string;
}

export interface WormAuditStore {
  append(entry: Omit<WormAuditEntry, 'entryId' | 'previousEntryHash' | 'chainHash'>): Promise<WormAuditEntry>;
  list(tenantId: string): Promise<ReadonlyArray<WormAuditEntry>>;
  /** Walks the chain and verifies every link. */
  verify(tenantId: string): Promise<{ ok: boolean; brokenAt?: number }>;
}

export function createInMemoryWormAuditStore(): WormAuditStore {
  const byTenant = new Map<string, WormAuditEntry[]>();
  let counter = 0;

  function chainHashOf(entry: Omit<WormAuditEntry, 'chainHash'>): string {
    return sha256Hex(
      JSON.stringify({
        entryId: entry.entryId,
        tenantId: entry.tenantId,
        actorId: entry.actorId,
        documentKind: entry.documentKind,
        documentId: entry.documentId,
        renderedAtIso: entry.renderedAtIso,
        renderedSha256: entry.renderedSha256,
        citationsSha256: entry.citationsSha256,
        previousEntryHash: entry.previousEntryHash,
      }),
    );
  }

  return {
    async append(input) {
      counter += 1;
      const tail = byTenant.get(input.tenantId) ?? [];
      const previous = tail.length > 0 ? tail[tail.length - 1]! : null;
      const entryId = `worm-${Date.now()}-${counter}`;
      const previousEntryHash = previous?.chainHash ?? null;
      const draft: Omit<WormAuditEntry, 'chainHash'> = {
        ...input,
        entryId,
        previousEntryHash,
      };
      const chainHash = chainHashOf(draft);
      const entry: WormAuditEntry = Object.freeze({ ...draft, chainHash });
      tail.push(entry);
      byTenant.set(input.tenantId, tail);
      return entry;
    },
    async list(tenantId) {
      return Object.freeze([...(byTenant.get(tenantId) ?? [])]);
    },
    async verify(tenantId) {
      const tail = byTenant.get(tenantId) ?? [];
      let prevHash: string | null = null;
      for (let i = 0; i < tail.length; i++) {
        const e = tail[i]!;
        if (e.previousEntryHash !== prevHash) {
          return { ok: false, brokenAt: i };
        }
        const recomputed = chainHashOf({
          entryId: e.entryId,
          tenantId: e.tenantId,
          actorId: e.actorId,
          documentKind: e.documentKind,
          documentId: e.documentId,
          renderedAtIso: e.renderedAtIso,
          renderedSha256: e.renderedSha256,
          citationsSha256: e.citationsSha256,
          previousEntryHash: e.previousEntryHash,
        });
        if (recomputed !== e.chainHash) {
          return { ok: false, brokenAt: i };
        }
        prevHash = e.chainHash;
      }
      return { ok: true };
    },
  };
}

export function citationsSha256(citations: ReadonlyArray<Citation>): string {
  const stable = [...citations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({
      id: c.id,
      claim: c.claim,
      sourceKind: c.source.kind,
      sourceRef: c.source.ref,
    }));
  return sha256Hex(JSON.stringify(stable));
}
