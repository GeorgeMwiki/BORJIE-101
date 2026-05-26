/**
 * Linear dedup-on-cursor tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryLinearRepository, type LinearRecordRow } from '../repositories/in-memory.js';

function row(updatedAt: string, title: string): LinearRecordRow {
  return {
    id: 'r',
    tenantId: 'tenant-mwikila',
    account: 'BORJIE',
    entityKind: 'issue',
    entityId: 'lin-1',
    fields: {
      entityKind: 'issue',
      entityId: 'lin-1',
      title,
      state: 'Open',
      assigneeEmailHashed: null,
      description: null,
      updatedAt,
    },
    updatedAt,
    raw: { id: 'lin-1' },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('linear/dedup', () => {
  it('upserts new row', async () => {
    const repo = createInMemoryLinearRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    expect((await repo.all()).length).toBe(1);
  });
  it('overwrites with newer updatedAt', async () => {
    const repo = createInMemoryLinearRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'B'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'BORJIE', entityKind: 'issue', entityId: 'lin-1' });
    expect(r?.fields.title).toBe('B');
  });
  it('does not overwrite with older updatedAt', async () => {
    const repo = createInMemoryLinearRepository();
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'B'));
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'BORJIE', entityKind: 'issue', entityId: 'lin-1' });
    expect(r?.fields.title).toBe('B');
  });
});
