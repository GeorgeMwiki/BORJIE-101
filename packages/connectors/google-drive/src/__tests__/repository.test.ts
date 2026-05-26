import { describe, it, expect } from 'vitest';
import { createInMemoryDriveRepository } from '../repositories/in-memory.js';
import type { DriveFile } from '../types.js';

function makeRow(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: 'uuid-1',
    tenantId: 'tenant_a',
    account: 'george@borjie.test',
    fileId: 'file-1',
    name: 'plan.gdoc',
    mimeType: 'application/vnd.google-apps.document',
    parents: ['root'],
    modifiedAt: '2026-05-25T08:00:00.000Z',
    extractedText: 'text',
    raw: {},
    ingestedAt: '2026-05-26T10:00:00.000Z',
    auditHash: 'audit-1',
    ...overrides,
  };
}

describe('Drive in-memory repository', () => {
  it('insert is idempotent on (tenant, account, fileId)', async () => {
    const repo = createInMemoryDriveRepository();
    expect((await repo.insert(makeRow())).inserted).toBe(true);
    expect((await repo.insert(makeRow())).inserted).toBe(false);
  });

  it('upsert flips updated=true on the second write', async () => {
    const repo = createInMemoryDriveRepository();
    const first = await repo.upsert(makeRow());
    const second = await repo.upsert(makeRow({ extractedText: 'updated' }));
    expect(first.inserted).toBe(true);
    expect(second.updated).toBe(true);
    const row = await repo.find('tenant_a', 'george@borjie.test', 'file-1');
    expect(row?.extractedText).toBe('updated');
  });

  it('separates rows across accounts within the same tenant', async () => {
    const repo = createInMemoryDriveRepository();
    await repo.insert(makeRow({ account: 'a@borjie.test', fileId: 'X' }));
    await repo.insert(makeRow({ account: 'b@borjie.test', fileId: 'X' }));
    const all = await repo.listByTenant('tenant_a');
    expect(all.length).toBe(2);
  });
});
