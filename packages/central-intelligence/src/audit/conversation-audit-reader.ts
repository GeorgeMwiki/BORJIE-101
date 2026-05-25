/**
 * ConversationAuditReader — the read-side companion to
 * ConversationAuditRecorder.
 *
 * The reader queries the same underlying audit chain the recorder
 * writes to, filtered to a specific thread's resourceUri and scoped
 * to a specific ScopeContext (tenant or platform). It is the surface
 * the gateway's `GET /api/v1/intelligence/thread/:id/audit` endpoint
 * calls into, and the same interface the admin-web uses
 * to display the cryptographic trail for a platform-scope
 * conversation.
 *
 * Two canonical adapters ship:
 *
 *   - `createInMemoryAuditSinkAndReader()` — a pair that share a
 *     single in-memory list. Tests + degraded-mode deployments use
 *     this so the audit surface is always functional.
 *
 *   - The production wiring (in services/api-gateway/src/composition)
 *     plugs the existing AuditTrailRepository from the ai-copilot
 *     package as BOTH the sink (record) and the reader (list) by
 *     filtering `list(tenantId)` results on a `resourceUri` prefix.
 */

import type { AuditSink, AuditSinkInput } from './conversation-audit.js';
import type { ScopeContext } from '../types.js';
import { PLATFORM_AUDIT_TENANT_ID } from './conversation-audit.js';

/** A row as visible to readers — this is the persisted view of an
 *  entry after the chain has computed its sequence + hashes. We do
 *  NOT re-export the audit-trail v2 AuditTrailEntry type here to
 *  keep the central-intelligence dependency graph shallow; the
 *  gateway maps the two at the composition boundary. */
export interface ConversationAuditRecord {
  readonly id: string;
  readonly sequenceId: number;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly actionKind: string;
  readonly actionCategory: string;
  readonly subjectResourceUri: string | null;
  readonly aiModelVersion: string | null;
  readonly promptHash: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly decision: string;
  readonly prevHash: string;
  readonly thisHash: string;
  readonly signature: string | null;
}

export interface ConversationAuditReader {
  /** List the audit records for a single thread in the given scope,
   *  in ascending sequence order. The implementation MUST enforce
   *  that cross-scope probes return an empty array — never leak the
   *  existence of another tenant's (or the platform's) thread. */
  listForThread(args: {
    readonly threadId: string;
    readonly ctx: ScopeContext;
    readonly limit?: number;
  }): Promise<ReadonlyArray<ConversationAuditRecord>>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory pair — sink + reader sharing a single list.
// Real cryptography (hash chain) is NOT applied here. Production
// deployments must use the Postgres-backed audit-trail v2 adapter
// which signs + chains properly. This in-memory pair is for tests and
// degraded-mode where the chain is best-effort, not compliance-grade.
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryAuditSinkAndReader(): {
  readonly sink: AuditSink;
  readonly reader: ConversationAuditReader;
} {
  const rows: ConversationAuditRecord[] = [];
  let seq = 0;
  let prevHash = 'GENESIS';

  const sink: AuditSink = {
    async record(input: AuditSinkInput) {
      seq += 1;
      const id = `ent_mem_${seq}`;
      const occurredAt = (input.occurredAt ?? new Date()).toISOString();
      const evidence = input.ai?.attachments ?? {};
      // "Hash" = a hand-rolled fingerprint. Not cryptographic; the
      // Postgres adapter provides real SHA-256 + HMAC signatures.
      const thisHash = `mem:${seq}:${input.actionKind}`;
      rows.push({
        id,
        sequenceId: seq,
        occurredAt,
        tenantId: input.tenantId,
        actorKind: input.actor.kind,
        actorId: input.actor.id ?? null,
        actionKind: input.actionKind,
        actionCategory: input.actionCategory,
        subjectResourceUri: input.subject?.resourceUri ?? null,
        aiModelVersion: input.ai?.modelVersion ?? null,
        promptHash: input.ai?.promptHash ?? null,
        evidence,
        decision: input.decision ?? 'noop',
        prevHash,
        thisHash,
        signature: null,
      });
      prevHash = thisHash;
      return { id, sequenceId: seq };
    },
  };

  const reader: ConversationAuditReader = {
    async listForThread({ threadId, ctx, limit }) {
      const expectedTenant =
        ctx.kind === 'tenant' ? ctx.tenantId : PLATFORM_AUDIT_TENANT_ID;
      const prefix = `ci:/thread/${threadId}/`;
      const cap = limit ?? 500;
      const out: ConversationAuditRecord[] = [];
      for (const r of rows) {
        if (r.tenantId !== expectedTenant) continue;
        if (!r.subjectResourceUri || !r.subjectResourceUri.startsWith(prefix)) continue;
        out.push(r);
        if (out.length >= cap) break;
      }
      return out.slice().sort((a, b) => a.sequenceId - b.sequenceId);
    },
  };

  return { sink, reader };
}
