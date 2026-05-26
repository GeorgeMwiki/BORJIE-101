/**
 * GitLab dedup-on-cursor tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryGitLabRepository, type GitLabRecordRow } from '../repositories/in-memory.js';

function row(updatedAt: string, title: string): GitLabRecordRow {
  return {
    id: 'r',
    tenantId: 'tenant-mwikila',
    account: 'borjie-group',
    entityKind: 'issue',
    entityId: '1',
    fields: {
      entityKind: 'issue',
      entityId: '1',
      iid: 7,
      title,
      state: 'opened',
      authorUsername: 'mwikila',
      authorEmailHashed: null,
      updatedAt,
    },
    updatedAt,
    raw: { id: 1 },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('gitlab/dedup', () => {
  it('upserts new row', async () => {
    const repo = createInMemoryGitLabRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    expect((await repo.all()).length).toBe(1);
  });
  it('overwrites with newer updatedAt', async () => {
    const repo = createInMemoryGitLabRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'v2'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'borjie-group', entityKind: 'issue', entityId: '1' });
    expect(r?.fields.title).toBe('v2');
  });
  it('does not overwrite with older updatedAt', async () => {
    const repo = createInMemoryGitLabRepository();
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'v2'));
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'borjie-group', entityKind: 'issue', entityId: '1' });
    expect(r?.fields.title).toBe('v2');
  });
});
