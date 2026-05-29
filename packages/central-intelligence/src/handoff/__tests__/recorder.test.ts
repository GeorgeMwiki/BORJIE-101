/**
 * Recorder tests — hash-chained insert + resolve.
 *
 * Uses an in-memory db double that responds to the same `text` /
 * `values` envelope the recorder emits. The double also enforces the
 * tenant predicate so we can verify cross-tenant denial without
 * a live Postgres.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandoffRecorder, type HandoffDbLike } from '../recorder.js';
import { HandoffError, type ChatHandoff } from '../types.js';

interface Row extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  source_session_id: string;
  source_user_id: string;
  target_user_id: string;
  target_role: string;
  topic: string;
  scope_payload: unknown;
  resolved_at: string | null;
  resolution: string | null;
  reply_text: string | null;
  audit_chain_seq: number;
  entry_hash: string;
  prev_hash: string | null;
  created_at: string;
}

function makeDb(): {
  db: HandoffDbLike;
  rows: Row[];
  inserts: number;
  updates: number;
} {
  const rows: Row[] = [];
  let inserts = 0;
  let updates = 0;
  const db: HandoffDbLike = {
    async execute(query: unknown) {
      const q = query as { text: string; values: ReadonlyArray<unknown> };
      const text = q.text;
      const values = q.values;

      if (text.startsWith('SELECT entry_hash')) {
        const tenantId = String(values[0]);
        const scoped = rows.filter((r) => r.tenant_id === tenantId);
        if (scoped.length === 0) return [];
        const head = scoped[scoped.length - 1]!;
        return [
          {
            entry_hash: head.entry_hash,
            max_seq: head.audit_chain_seq,
          },
        ];
      }

      if (text.startsWith('INSERT INTO chat_handoffs')) {
        inserts += 1;
        const row: Row = {
          id: randomUUID(),
          tenant_id: String(values[0]),
          source_session_id: String(values[1]),
          source_user_id: String(values[2]),
          target_user_id: String(values[3]),
          target_role: String(values[4]),
          topic: String(values[5]),
          scope_payload: JSON.parse(String(values[6])),
          resolved_at: null,
          resolution: null,
          reply_text: null,
          audit_chain_seq: Number(values[7]),
          entry_hash: String(values[8]),
          prev_hash: values[9] === null ? null : String(values[9]),
          created_at: String(values[10]),
        };
        rows.push(row);
        return [row];
      }

      if (text.startsWith('UPDATE chat_handoffs')) {
        updates += 1;
        const tenantId = String(values[0]);
        const handoffId = String(values[1]);
        const row = rows.find(
          (r) =>
            r.tenant_id === tenantId &&
            r.id === handoffId &&
            r.resolved_at === null,
        );
        if (!row) return [];
        row.resolved_at = String(values[2]);
        row.resolution = String(values[3]);
        row.reply_text = values[4] === null ? null : String(values[4]);
        return [row];
      }

      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, rows, inserts, updates };
}

describe('createHandoffRecorder', () => {
  it('records a handoff with a fresh chain (prevHash null, seq 1)', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({
      db,
      now: () => new Date('2026-05-29T12:00:00.000Z'),
    });
    const result = await recorder.recordHandoff({
      tenantId: 'tenant_a',
      sourceSessionId: 'sess_1',
      sourceUserId: 'owner_1',
      targetUserId: 'mgr_1',
      targetRole: 'T3_module_manager',
      topic: 'Mwadui site safety follow-up',
      scopePayload: { siteIds: ['mwadui'], category: 'safety' },
    });
    expect(result.tenantId).toBe('tenant_a');
    expect(result.targetRole).toBe('T3_module_manager');
    expect(result.prevHash).toBeNull();
    expect(result.auditChainSeq).toBe(1);
    expect(result.entryHash.length).toBeGreaterThan(10);
    expect(result.resolvedAt).toBeNull();
  });

  it('chains the second handoff off the first (prevHash = previous entryHash)', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({
      db,
      now: () => new Date('2026-05-29T12:00:00.000Z'),
    });
    const first = await recorder.recordHandoff({
      tenantId: 't1',
      sourceSessionId: 's1',
      sourceUserId: 'o1',
      targetUserId: 'm1',
      targetRole: 'T3_module_manager',
      topic: 'topic 1',
    });
    const second = await recorder.recordHandoff({
      tenantId: 't1',
      sourceSessionId: 's1',
      sourceUserId: 'o1',
      targetUserId: 'm2',
      targetRole: 'T3_module_manager',
      topic: 'topic 2',
    });
    expect(second.prevHash).toBe(first.entryHash);
    expect(second.auditChainSeq).toBe(2);
  });

  it('keeps two tenants on separate chains (cross-tenant isolation)', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({
      db,
      now: () => new Date('2026-05-29T12:00:00.000Z'),
    });
    const a = await recorder.recordHandoff({
      tenantId: 'tenant_a',
      sourceSessionId: 's',
      sourceUserId: 'u',
      targetUserId: 'v',
      targetRole: 'T3_module_manager',
      topic: 'topic a',
    });
    const b = await recorder.recordHandoff({
      tenantId: 'tenant_b',
      sourceSessionId: 's',
      sourceUserId: 'u',
      targetUserId: 'v',
      targetRole: 'T3_module_manager',
      topic: 'topic b',
    });
    expect(a.tenantId).toBe('tenant_a');
    expect(b.tenantId).toBe('tenant_b');
    expect(b.prevHash).toBeNull();
    expect(b.auditChainSeq).toBe(1);
  });

  it('throws invalid_input when source == target user', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({ db });
    await expect(
      recorder.recordHandoff({
        tenantId: 't',
        sourceSessionId: 's',
        sourceUserId: 'same_user',
        targetUserId: 'same_user',
        targetRole: 'T3_module_manager',
        topic: 'topic',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('fires the notification port AFTER persistence', async () => {
    const { db } = makeDb();
    const notifications: ChatHandoff[] = [];
    const recorder = createHandoffRecorder({
      db,
      notificationPort: {
        async notify(h) {
          notifications.push(h);
        },
      },
    });
    const result = await recorder.recordHandoff({
      tenantId: 't',
      sourceSessionId: 's',
      sourceUserId: 'a',
      targetUserId: 'b',
      targetRole: 'T3_module_manager',
      topic: 'hello',
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.id).toBe(result.id);
  });

  it('swallows notification port failures without breaking the chain', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({
      db,
      notificationPort: {
        async notify() {
          throw new Error('SMS provider down');
        },
      },
    });
    // Must not throw.
    const result = await recorder.recordHandoff({
      tenantId: 't',
      sourceSessionId: 's',
      sourceUserId: 'a',
      targetUserId: 'b',
      targetRole: 'T3_module_manager',
      topic: 'hello',
    });
    expect(result.id).toBeTruthy();
  });

  it('resolves a handoff with replyText and sets resolvedAt', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({
      db,
      now: () => new Date('2026-05-29T13:00:00.000Z'),
    });
    const handoff = await recorder.recordHandoff({
      tenantId: 't',
      sourceSessionId: 's',
      sourceUserId: 'a',
      targetUserId: 'b',
      targetRole: 'T3_module_manager',
      topic: 'hello',
    });
    const resolved = await recorder.resolveHandoff({
      tenantId: 't',
      handoffId: handoff.id,
      resolution: 'replied',
      replyText: 'I have followed up.',
    });
    expect(resolved.resolution).toBe('replied');
    expect(resolved.replyText).toBe('I have followed up.');
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('throws unknown_handoff when resolving a missing id', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({ db });
    await expect(
      recorder.resolveHandoff({
        tenantId: 't',
        handoffId: '00000000-0000-0000-0000-000000000000',
        resolution: 'closed',
      }),
    ).rejects.toMatchObject({ code: 'unknown_handoff' });
  });

  it('denies cross-tenant resolve (handoff invisible to other tenant)', async () => {
    const { db } = makeDb();
    const recorder = createHandoffRecorder({ db });
    const handoff = await recorder.recordHandoff({
      tenantId: 'tenant_a',
      sourceSessionId: 's',
      sourceUserId: 'a',
      targetUserId: 'b',
      targetRole: 'T3_module_manager',
      topic: 'hello',
    });
    await expect(
      recorder.resolveHandoff({
        tenantId: 'tenant_b',
        handoffId: handoff.id,
        resolution: 'replied',
      }),
    ).rejects.toMatchObject({ code: 'unknown_handoff' });
  });

  it('raises a HandoffError instance (typed error)', () => {
    const err = new HandoffError('cross_tenant_denied', 'denied');
    expect(err.name).toBe('HandoffError');
    expect(err.code).toBe('cross_tenant_denied');
  });
});
