/**
 * HubSpot dedup-on-cursor tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryHubSpotRepository, type HubSpotRecordRow } from '../repositories/in-memory.js';

function row(updatedAt: string, name: string): HubSpotRecordRow {
  return {
    id: 'r1',
    tenantId: 'tenant-mwikila',
    account: '12345',
    objectType: 'contacts',
    objectId: '1',
    properties: {
      objectType: 'contacts',
      objectId: '1',
      firstName: name,
      lastName: null,
      company: null,
      emailHashed: null,
      phoneHashed: null,
      dealName: null,
      amount: null,
      stage: null,
      updatedAt,
    },
    updatedAt,
    raw: { id: '1' },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('hubspot/dedup', () => {
  it('upserts new row', async () => {
    const repo = createInMemoryHubSpotRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    expect((await repo.all()).length).toBe(1);
  });
  it('overwrites with newer updatedAt', async () => {
    const repo = createInMemoryHubSpotRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'B'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: '12345', objectType: 'contacts', objectId: '1' });
    expect(r?.properties.firstName).toBe('B');
  });
  it('does not overwrite with older updatedAt', async () => {
    const repo = createInMemoryHubSpotRepository();
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'B'));
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'A'));
    const r = await repo.findByKey({ tenantId: 'tenant-mwikila', account: '12345', objectType: 'contacts', objectId: '1' });
    expect(r?.properties.firstName).toBe('B');
  });
});
