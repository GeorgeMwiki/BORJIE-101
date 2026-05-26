/**
 * GitHub dedup-on-cursor tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryGitHubRepository, type GitHubRecordRow } from '../repositories/in-memory.js';

function row(updatedAt: string, title: string): GitHubRecordRow {
  return {
    id: 'r',
    tenantId: 'tenant-mwikila',
    account: 'borjie-org',
    entityKind: 'pull_request',
    entityId: 'I_kw1',
    fields: {
      entityKind: 'pull_request',
      entityId: 'I_kw1',
      number: 42,
      title,
      state: 'open',
      authorLogin: 'mwikila',
      authorEmailHashed: null,
      updatedAt,
    },
    updatedAt,
    raw: { node_id: 'I_kw1' },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('github/dedup', () => {
  it('upserts new row', async () => {
    const repo = createInMemoryGitHubRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    expect((await repo.all()).length).toBe(1);
  });
  it('overwrites with newer updatedAt', async () => {
    const repo = createInMemoryGitHubRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'v2'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'borjie-org', entityKind: 'pull_request', entityId: 'I_kw1' });
    expect(r?.fields.title).toBe('v2');
  });
  it('does not overwrite with older updatedAt', async () => {
    const repo = createInMemoryGitHubRepository();
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'v2'));
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: 'borjie-org', entityKind: 'pull_request', entityId: 'I_kw1' });
    expect(r?.fields.title).toBe('v2');
  });
});
