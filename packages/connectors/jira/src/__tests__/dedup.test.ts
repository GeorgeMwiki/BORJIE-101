/**
 * Jira dedup-on-cursor tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryJiraRepository, type JiraRecordRow } from '../repositories/in-memory.js';

function row(updatedAt: string, summary: string): JiraRecordRow {
  return {
    id: 'r',
    tenantId: 'tenant-mwikila',
    account: 'site-cloud-id-abc',
    entityKind: 'issue',
    entityId: '10001',
    fields: {
      entityKind: 'issue',
      entityId: '10001',
      key: 'PROJ-1',
      summary,
      status: 'Open',
      assigneeEmailHashed: null,
      reporterEmailHashed: null,
      updatedAt,
    },
    updatedAt,
    raw: { id: '10001' },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('jira/dedup', () => {
  it('upserts new row', async () => {
    const repo = createInMemoryJiraRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    expect((await repo.all()).length).toBe(1);
  });
  it('overwrites with newer updatedAt', async () => {
    const repo = createInMemoryJiraRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'B'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'site-cloud-id-abc', entityKind: 'issue', entityId: '10001' });
    expect(r?.fields.summary).toBe('B');
  });
  it('does not overwrite with older updatedAt', async () => {
    const repo = createInMemoryJiraRepository();
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'B'));
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'site-cloud-id-abc', entityKind: 'issue', entityId: '10001' });
    expect(r?.fields.summary).toBe('B');
  });
});
