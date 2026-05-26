import { describe, it, expect } from 'vitest';
import {
  createInMemoryNotionPageRepository,
  createInMemoryNotionBlockRepository,
} from '../repositories/in-memory.js';
import type { NotionPage, NotionBlock } from '../types.js';

function makePage(overrides: Partial<NotionPage> = {}): NotionPage {
  return {
    id: 'uuid-page-1',
    tenantId: 'tenant_a',
    workspaceId: 'ws_1',
    pageId: 'page-1',
    parentId: null,
    title: 'hashed-title',
    properties: {},
    lastEditedAt: '2026-05-25T08:00:00.000Z',
    raw: {},
    ingestedAt: '2026-05-26T10:00:00.000Z',
    auditHash: 'audit-1',
    ...overrides,
  };
}

function makeBlock(overrides: Partial<NotionBlock> = {}): NotionBlock {
  return {
    id: 'uuid-block-1',
    tenantId: 'tenant_a',
    workspaceId: 'ws_1',
    blockId: 'block-1',
    parentId: 'page-1',
    kind: 'text',
    content: {},
    lastEditedAt: '2026-05-25T08:00:00.000Z',
    raw: {},
    ingestedAt: '2026-05-26T10:00:00.000Z',
    auditHash: 'audit-2',
    ...overrides,
  };
}

describe('Notion in-memory repos', () => {
  it('page repo is idempotent on (tenant, workspace, page)', async () => {
    const repo = createInMemoryNotionPageRepository();
    expect((await repo.insert(makePage())).inserted).toBe(true);
    expect((await repo.insert(makePage())).inserted).toBe(false);
  });

  it('block repo is idempotent on (tenant, workspace, block)', async () => {
    const repo = createInMemoryNotionBlockRepository();
    expect((await repo.insert(makeBlock())).inserted).toBe(true);
    expect((await repo.insert(makeBlock())).inserted).toBe(false);
  });

  it('separates rows across tenants', async () => {
    const repo = createInMemoryNotionPageRepository();
    await repo.insert(makePage({ tenantId: 'tenant_a' }));
    await repo.insert(makePage({ tenantId: 'tenant_b' }));
    expect((await repo.listByTenant('tenant_a')).length).toBe(1);
    expect((await repo.listByTenant('tenant_b')).length).toBe(1);
  });
});
