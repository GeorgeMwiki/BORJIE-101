/**
 * Handoff recorder — hash-chained writer for `chat_handoffs`.
 *
 * Two append-only writes:
 *
 *   recordHandoff(input)   inserts a row, computes the entry_hash, fires
 *                          the optional notification port, returns the
 *                          full ChatHandoff.
 *   resolveHandoff(input)  closes a handoff (replied / closed / declined),
 *                          updates the row, returns the resolved ChatHandoff.
 *
 * Tenant isolation lives at the RLS layer via the canonical `app.tenant_id`
 * GUC the api-gateway middleware binds per request. The recorder never
 * double-filters. Cross-tenant routing is denied at the route layer via
 * the RLS check (the target_user_id row must be visible to the source's
 * tenant context).
 *
 * Audit chain: every row is chained off the previous row's `entry_hash`
 * within the same tenant — identical primitive to `decisions`. The
 * `audit_chain_seq` field is a monotonic counter per tenant so an
 * auditor can detect gaps in O(1).
 *
 * Failure containment:
 *  - zod validation rejects with `invalid_input`.
 *  - persistence errors bubble as `persistence_failed`.
 *  - resolving an unknown handoff raises `unknown_handoff`.
 */

import { z } from 'zod';
import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';
import {
  HANDOFF_PERSONA_ROLES,
  HANDOFF_RESOLUTIONS,
  HandoffError,
  type ChatHandoff,
  type RecordHandoffInput,
  type ResolveHandoffInput,
} from './types.js';

// Minimal DB port — accepts the drizzle-orm sql tag result OR a plain
// rows array. Matches the shape used by the decision recorder so the
// composition root can pass the same client.
export interface HandoffDbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

const RecordHandoffSchema = z
  .object({
    tenantId: z.string().min(1).max(80),
    sourceSessionId: z.string().min(1).max(160),
    sourceUserId: z.string().min(1).max(120),
    targetUserId: z.string().min(1).max(120),
    targetRole: z.enum(HANDOFF_PERSONA_ROLES),
    topic: z.string().min(3).max(400),
    scopePayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (v) => v.sourceUserId !== v.targetUserId,
    'source and target users must differ',
  );

const ResolveHandoffSchema = z
  .object({
    tenantId: z.string().min(1).max(80),
    handoffId: z.string().uuid(),
    resolution: z.enum(HANDOFF_RESOLUTIONS),
    replyText: z.string().max(4000).optional().nullable(),
  })
  .strict();

export interface HandoffNotificationPort {
  /**
   * Fire a notification to the recipient (push / sms / in-app). The
   * recorder calls this AFTER the row is persisted so a failed
   * notification cannot leave the chain in an inconsistent state.
   * Implementations must swallow their own errors (the recorder
   * logs + ignores port failures so the handoff still lands).
   */
  notify(handoff: ChatHandoff): Promise<void>;
}

export interface HandoffRecorderDeps {
  readonly db: HandoffDbLike;
  readonly now?: () => Date;
  readonly chainSecret?: string;
  readonly notificationPort?: HandoffNotificationPort;
}

export interface HandoffRecorder {
  recordHandoff(input: RecordHandoffInput): Promise<ChatHandoff>;
  resolveHandoff(input: ResolveHandoffInput): Promise<ChatHandoff>;
}

function computeHash(
  prev: string | null,
  payload: Record<string, unknown>,
  secret: string | undefined,
): string {
  return chainHash({ prev: prev ?? GENESIS_HASH, payload }, secret);
}

function toChatHandoff(row: ExecRow): ChatHandoff {
  return Object.freeze({
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    sourceSessionId: String(row['source_session_id']),
    sourceUserId: String(row['source_user_id']),
    targetUserId: String(row['target_user_id']),
    targetRole: row['target_role'] as ChatHandoff['targetRole'],
    topic: String(row['topic']),
    scopePayload: (row['scope_payload'] as ChatHandoff['scopePayload']) ?? {},
    resolvedAt:
      row['resolved_at'] === null || row['resolved_at'] === undefined
        ? null
        : String(row['resolved_at']),
    resolution:
      row['resolution'] === null || row['resolution'] === undefined
        ? null
        : (row['resolution'] as ChatHandoff['resolution']),
    replyText:
      row['reply_text'] === null || row['reply_text'] === undefined
        ? null
        : String(row['reply_text']),
    auditChainSeq: Number(row['audit_chain_seq']),
    entryHash: String(row['entry_hash']),
    prevHash:
      row['prev_hash'] === null || row['prev_hash'] === undefined
        ? null
        : String(row['prev_hash']),
    createdAt: String(row['created_at']),
  });
}

export function createHandoffRecorder(
  deps: HandoffRecorderDeps,
): HandoffRecorder {
  const now = deps.now ?? (() => new Date());

  return Object.freeze({
    async recordHandoff(input: RecordHandoffInput) {
      const parsed = RecordHandoffSchema.safeParse(input);
      if (!parsed.success) {
        throw new HandoffError(
          'invalid_input',
          `recordHandoff invalid: ${parsed.error.message}`,
        );
      }
      const value = parsed.data;
      const scope = Object.freeze({ ...(value.scopePayload ?? {}) });
      const createdAt = now().toISOString();

      // Read the head of the chain + the next sequence in one round-trip.
      // Both reads are RLS-scoped to the tenant via app.tenant_id.
      const headRows = rowsOf(
        await deps.db.execute({
          // The composition root passes drizzle's sql`...`; in tests the
          // double executes a literal string with `tenantId` parameter.
          // We pre-bind here as a static query because the value is
          // already validated.
          text:
            'SELECT entry_hash, COALESCE(MAX(audit_chain_seq), 0) AS max_seq ' +
            'FROM chat_handoffs ' +
            'WHERE tenant_id = $1 ' +
            'GROUP BY entry_hash ' +
            'ORDER BY audit_chain_seq DESC ' +
            'LIMIT 1',
          values: [value.tenantId],
        }),
      );
      const prevHash =
        headRows.length > 0 && typeof headRows[0]?.['entry_hash'] === 'string'
          ? String(headRows[0]?.['entry_hash'])
          : null;
      const nextSeq =
        headRows.length > 0
          ? Number(headRows[0]?.['max_seq'] ?? 0) + 1
          : 1;

      const payload = {
        tenant_id: value.tenantId,
        source_session_id: value.sourceSessionId,
        source_user_id: value.sourceUserId,
        target_user_id: value.targetUserId,
        target_role: value.targetRole,
        topic: value.topic,
        scope_payload: scope,
        audit_chain_seq: nextSeq,
        created_at: createdAt,
      };
      const entryHash = computeHash(prevHash, payload, deps.chainSecret);

      let rows: ReadonlyArray<ExecRow> = [];
      try {
        rows = rowsOf(
          await deps.db.execute({
            text:
              'INSERT INTO chat_handoffs (' +
              '  tenant_id, source_session_id, source_user_id, target_user_id,' +
              '  target_role, topic, scope_payload, audit_chain_seq,' +
              '  entry_hash, prev_hash, created_at' +
              ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)' +
              'RETURNING id, tenant_id, source_session_id, source_user_id,' +
              '  target_user_id, target_role, topic, scope_payload, ' +
              '  resolved_at, resolution, reply_text, audit_chain_seq,' +
              '  entry_hash, prev_hash, created_at',
            values: [
              value.tenantId,
              value.sourceSessionId,
              value.sourceUserId,
              value.targetUserId,
              value.targetRole,
              value.topic,
              JSON.stringify(scope),
              nextSeq,
              entryHash,
              prevHash,
              createdAt,
            ],
          }),
        );
      } catch (err) {
        throw new HandoffError(
          'persistence_failed',
          `recordHandoff insert failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const row = rows[0];
      if (!row) {
        throw new HandoffError(
          'persistence_failed',
          'recordHandoff returned no row',
        );
      }
      const handoff = toChatHandoff(row);

      // Fire-and-forget notification. Port implementations swallow their
      // own errors per the contract; we wrap in a try/catch as a final
      // belt-and-braces guard so a misbehaving port never breaks the
      // chain.
      if (deps.notificationPort) {
        try {
          await deps.notificationPort.notify(handoff);
        } catch {
          // Intentional swallow — handoff already persisted; the
          // notification can be replayed by a reconciliation worker.
        }
      }

      return handoff;
    },

    async resolveHandoff(input: ResolveHandoffInput) {
      const parsed = ResolveHandoffSchema.safeParse(input);
      if (!parsed.success) {
        throw new HandoffError(
          'invalid_input',
          `resolveHandoff invalid: ${parsed.error.message}`,
        );
      }
      const value = parsed.data;
      const resolvedAt = now().toISOString();

      let rows: ReadonlyArray<ExecRow> = [];
      try {
        rows = rowsOf(
          await deps.db.execute({
            text:
              'UPDATE chat_handoffs ' +
              'SET resolved_at = $3, resolution = $4, reply_text = $5 ' +
              'WHERE tenant_id = $1 AND id = $2 AND resolved_at IS NULL ' +
              'RETURNING id, tenant_id, source_session_id, source_user_id,' +
              '  target_user_id, target_role, topic, scope_payload,' +
              '  resolved_at, resolution, reply_text, audit_chain_seq,' +
              '  entry_hash, prev_hash, created_at',
            values: [
              value.tenantId,
              value.handoffId,
              resolvedAt,
              value.resolution,
              value.replyText ?? null,
            ],
          }),
        );
      } catch (err) {
        throw new HandoffError(
          'persistence_failed',
          `resolveHandoff update failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const row = rows[0];
      if (!row) {
        throw new HandoffError(
          'unknown_handoff',
          `handoff ${value.handoffId} not found or already resolved`,
        );
      }
      return toChatHandoff(row);
    },
  });
}
