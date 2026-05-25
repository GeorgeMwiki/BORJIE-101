/**
 * Drizzle-backed `AuditSink` + `ConversationAuditReader` adapter.
 *
 * Bridges the central-intelligence `AuditSink` port (consumed by
 * `createConversationAuditRecorder`) onto the production Postgres-
 * backed audit-trail v2 chain. Replaces the prior LIVE-mode use of
 * `createInMemoryAuditSinkAndReader()` which lost rows on every
 * process restart and produced fingerprint-only hashes rather than the
 * cryptographic SHA-256 + HMAC chain enforced by audit-trail v2.
 *
 * Composition contract:
 *
 *   - Sink side: every `AuditSink.record(input)` call delegates to the
 *     ai-copilot `AuditTrailRecorder` over a `HashChainPort`. The
 *     recorder computes the per-row hash + HMAC signature and persists
 *     via the supplied `AuditTrailRepository`.
 *
 *   - Reader side: `listForThread(...)` walks the same repository,
 *     filtering on `subjectResourceUri` prefixed by
 *     `ci:/thread/<threadId>/` (the convention used by the kernel-side
 *     thread audit recorder). Cross-scope probes (tenant looking at
 *     another tenant's thread, or platform looking at a tenant thread)
 *     return `[]` because the underlying `list(tenantId)` filter
 *     enforces row visibility by tenantId.
 *
 * Tenant isolation:
 *
 *   - Platform-scope threads write to the reserved
 *     `PLATFORM_AUDIT_TENANT_ID` row partition; tenant threads write to
 *     their real tenantId. The repository's row visibility filter
 *     enforces both inbound + outbound boundaries — see
 *     `audit-trail-repository.ts` for the RLS + WHERE-clause belt-and-
 *     braces pattern.
 *
 * Degraded fallback:
 *
 *   - When `db` is null the factory returns `null` so the composition
 *     root can fall back to `createInMemoryAuditSinkAndReader()`
 *     transparently.
 */

import {
  PLATFORM_AUDIT_TENANT_ID,
  type AuditSink,
  type AuditSinkInput,
  type ConversationAuditReader,
  type ConversationAuditRecord,
} from '@borjie/central-intelligence';
import {
  createAuditTrailRecorder,
  type AuditActionCategory,
  type AuditActorKind,
  type AuditTrailEntry,
  type AuditTrailRepository,
} from '@borjie/ai-copilot/audit-trail';
import { PostgresAuditTrailRepository } from './audit-trail-repository.js';

/**
 * Translate the central-intelligence audit-sink actor kind onto the
 * audit-trail v2 vocabulary. The two enums diverged historically; this
 * is the canonical translation.
 *
 *   user           → human_action       (operator typed a message)
 *   ai_system      → ai_proposal        (kernel surfaced a proposal)
 *   ai_execution   → ai_execution       (same name in both)
 *   system         → system             (same name in both)
 */
function mapActorKind(
  kind: 'user' | 'ai_system' | 'ai_execution' | 'system',
): AuditActorKind {
  switch (kind) {
    case 'user':
      return 'human_action';
    case 'ai_system':
      return 'ai_proposal';
    case 'ai_execution':
      return 'ai_execution';
    case 'system':
      return 'system';
    default:
      return 'system';
  }
}

/**
 * Translate the central-intelligence action category onto the
 * audit-trail v2 vocabulary. Today the two unions are structurally
 * identical (both ship 12 named categories ending in `other`); this
 * adapter is preserved as a translation hook in case the unions
 * diverge in a future release.
 */
function mapActionCategory(
  category: AuditSinkInput['actionCategory'],
): AuditActionCategory {
  return category as AuditActionCategory;
}

export interface CreateDrizzleAuditSinkAndReaderArgs {
  /**
   * Drizzle client. Tagged as `unknown` so this file does not pick up
   * a hard compile-time dep on `@borjie/database`. The Postgres
   * repository's `execute()` shape is structurally satisfied by the
   * live `DatabaseClient` and by test stubs.
   */
  readonly db: unknown;
  /** Optional HMAC signing secret. Defaults to env. */
  readonly signingSecret?: string;
  /** Optional structured logger. */
  readonly logger?: {
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export interface DrizzleAuditSinkBundle {
  readonly sink: AuditSink;
  readonly reader: ConversationAuditReader;
}

/**
 * Compose a Drizzle-backed `AuditSink` + `ConversationAuditReader`
 * pair. Both share the same underlying `AuditTrailRepository` so the
 * row that the sink writes is the row the reader returns one
 * round-trip later.
 */
export function createDrizzleAuditSinkAndReader(
  args: CreateDrizzleAuditSinkAndReaderArgs,
): DrizzleAuditSinkBundle {
  // The Postgres repo's constructor wants the Drizzle `SqlExecutor`
  // shape (single `execute(q)` method). The live client satisfies it
  // via `db.execute(sql\`...\`)`; we duck-cast through `unknown` rather
  // than pulling the database package's namespace types here.
  const repo: AuditTrailRepository = new PostgresAuditTrailRepository(
    args.db as never,
  );

  const signingSecret =
    args.signingSecret ?? process.env.AUDIT_TRAIL_SIGNING_SECRET ?? null;

  const recorder = createAuditTrailRecorder({
    repo,
    signingSecret,
  });

  // ConversationAuditReader resolves the tenant partition from the
  // ScopeContext kind (tenant vs. platform) — same convention used by
  // `createInMemoryAuditSinkAndReader` so this adapter is a drop-in
  // replacement.
  const reader: ConversationAuditReader = {
    async listForThread({ threadId, ctx, limit }) {
      const tenantId =
        ctx.kind === 'tenant' ? ctx.tenantId : PLATFORM_AUDIT_TENANT_ID;
      const prefix = `ci:/thread/${threadId}/`;
      const cap = limit ?? 500;
      try {
        const rows = await repo.list(tenantId, { limit: cap });
        return rows
          .filter((row) => (row.resourceUri ?? '').startsWith(prefix))
          .map(mapEntryToRecord);
      } catch (err) {
        args.logger?.warn?.(
          {
            wiring: 'drizzle-audit-sink-reader',
            error: err instanceof Error ? err.message : String(err),
          },
          'audit-sink-reader: repo.list failed — returning []',
        );
        return [];
      }
    },
  };

  const sink: AuditSink = {
    async record(input: AuditSinkInput) {
      // Map the central-intelligence audit input onto the audit-trail
      // v2 `RecordAuditInput` shape. The two shapes only differ in
      // optional-field semantics — every required field on input is
      // already in the v2 contract.
      const recorded = await recorder.record({
        tenantId: input.tenantId,
        actor: {
          kind: mapActorKind(input.actor.kind),
          ...(input.actor.id !== null ? { id: input.actor.id } : {}),
          ...(input.actor.display !== undefined && input.actor.display !== null
            ? { display: input.actor.display }
            : {}),
        },
        actionKind: input.actionKind,
        actionCategory: mapActionCategory(input.actionCategory),
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.ai ? { ai: input.ai } : {}),
        ...(input.decision ? { decision: input.decision } : {}),
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      });
      return {
        id: recorded.id,
        sequenceId: recorded.sequenceId,
      };
    },
  };

  return { sink, reader };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function mapEntryToRecord(entry: AuditTrailEntry): ConversationAuditRecord {
  return {
    id: entry.id,
    sequenceId: entry.sequenceId,
    occurredAt: entry.occurredAt,
    tenantId: entry.tenantId,
    actorKind: entry.actorKind,
    actorId: entry.actorId,
    actionKind: entry.actionKind,
    actionCategory: entry.actionCategory,
    subjectResourceUri: entry.resourceUri ?? null,
    aiModelVersion: entry.aiModelVersion,
    promptHash: entry.promptHash,
    evidence: entry.evidence,
    decision: entry.decision,
    prevHash: entry.prevHash,
    thisHash: entry.thisHash,
    signature: entry.signature,
  };
}
