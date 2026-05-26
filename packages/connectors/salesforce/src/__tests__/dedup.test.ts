/**
 * Salesforce dedup-on-cursor tests — in-memory repository.
 *
 * Re-ingesting a row with an OLDER LastModifiedDate must NOT overwrite.
 * Cursor advances monotonically.
 */

import { describe, it, expect } from 'vitest';

import { createInMemorySalesforceRepository } from '../repositories/in-memory.js';
import type { SalesforceRecordRow } from '../repositories/in-memory.js';

function makeRow(lmd: string, name: string): SalesforceRecordRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 'tenant-mwikila',
    account: 'org-borjie',
    sobjectType: 'Account',
    sobjectId: '001xx0000000ABCAA0',
    fields: {
      sobjectType: 'Account',
      sobjectId: '001xx0000000ABCAA0',
      name,
      emailHashed: null,
      phoneHashed: null,
      stage: null,
      amount: null,
      closeDate: null,
      lastModifiedDate: lmd,
    },
    lastModifiedDate: lmd,
    raw: { Id: '001xx0000000ABCAA0', Name: name, LastModifiedDate: lmd },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('salesforce/dedup', () => {
  it('upserts a new row on first ingest', async () => {
    const repo = createInMemorySalesforceRepository();
    const row = makeRow('2026-01-15T10:00:00.000Z', 'Borjie Mining v1');
    const inserted = await repo.upsert(row);
    expect(inserted.fields.name).toBe('Borjie Mining v1');
    const all = await repo.all();
    expect(all).toHaveLength(1);
  });

  it('overwrites when LastModifiedDate is newer', async () => {
    const repo = createInMemorySalesforceRepository();
    await repo.upsert(makeRow('2026-01-15T10:00:00.000Z', 'Borjie Mining v1'));
    await repo.upsert(makeRow('2026-02-15T10:00:00.000Z', 'Borjie Mining v2'));
    const fetched = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      account: 'org-borjie',
      sobjectType: 'Account',
      sobjectId: '001xx0000000ABCAA0',
    });
    expect(fetched?.fields.name).toBe('Borjie Mining v2');
  });

  it('does NOT overwrite when LastModifiedDate is older (idempotent replay)', async () => {
    const repo = createInMemorySalesforceRepository();
    await repo.upsert(makeRow('2026-02-15T10:00:00.000Z', 'Borjie Mining v2'));
    await repo.upsert(makeRow('2026-01-15T10:00:00.000Z', 'Borjie Mining v1'));
    const fetched = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      account: 'org-borjie',
      sobjectType: 'Account',
      sobjectId: '001xx0000000ABCAA0',
    });
    expect(fetched?.fields.name).toBe('Borjie Mining v2');
  });
});
