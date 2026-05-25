/**
 * In-memory `TabRegistry` tests + Drizzle-adapter SQL coverage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createInMemoryTabRegistry,
  createDrizzleTabRegistry,
} from '../persistence/index.js';
import { buildFallbackTab } from '../generator/fallbacks.js';
import type { TabRegistry } from '../persistence/index.js';
import type { PortalTab, TabGenerationIntent } from '../types.js';

function mkTab(overrides: Partial<PortalTab> = {}): PortalTab {
  const intent: TabGenerationIntent = {
    proposedTabKey: 'hr.payroll',
    proposedTabTitle: 'Payroll',
    domain: 'hr',
    confidence: 0.8,
    evidence: [],
    sourceMessage: 's',
    usedLlm: false,
  };
  return {
    ...buildFallbackTab({
      intent,
      tenantId: 't1',
      userId: 'u1',
      actorId: 'system',
      nowIso: '2026-05-24T12:00:00.000Z',
      id: 'tab_a',
      sourceConversationId: undefined,
    }),
    ...overrides,
  };
}

describe('createInMemoryTabRegistry', () => {
  let reg: TabRegistry;
  beforeEach(() => {
    reg = createInMemoryTabRegistry();
  });

  it('saves + gets a tab', async () => {
    const tab = mkTab();
    await reg.save({ tab });
    const fetched = await reg.get(tab.id);
    expect(fetched?.tabKey).toBe('hr.payroll');
  });

  it('lists by tenantId + userId', async () => {
    await reg.save({ tab: mkTab({ id: 'a' }) });
    await reg.save({
      tab: mkTab({
        id: 'b',
        tabKey: 'finance.budgets',
        domain: 'finance',
        userId: 'u1',
      }),
    });
    const tabs = await reg.list({ tenantId: 't1', userId: 'u1' });
    expect(tabs.length).toBe(2);
  });

  it('lists tenant-default when userId is omitted', async () => {
    await reg.save({ tab: mkTab({ id: 'def', userId: null }) });
    const tabs = await reg.list({ tenantId: 't1' });
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.userId).toBeNull();
  });

  it('filters by persona', async () => {
    await reg.save({ tab: mkTab({ id: 'x' }) });
    const visible = await reg.list({
      tenantId: 't1',
      userId: 'u1',
      personaId: 'customer',
    });
    expect(visible.length).toBe(0);
  });

  it('filters by domain', async () => {
    await reg.save({ tab: mkTab({ id: 'a' }) });
    await reg.save({
      tab: mkTab({ id: 'b', tabKey: 'finance.x', domain: 'finance' }),
    });
    const tabs = await reg.list({
      tenantId: 't1',
      userId: 'u1',
      domain: 'finance',
    });
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.domain).toBe('finance');
  });

  it('rejects duplicate (tenantId, userId, tabKey)', async () => {
    await reg.save({ tab: mkTab({ id: 'a' }) });
    await expect(
      reg.save({ tab: mkTab({ id: 'b' /* same tab_key */ }) }),
    ).rejects.toThrow(/tab_key_already_exists/);
  });

  it('deletes by id within tenant', async () => {
    const tab = mkTab();
    await reg.save({ tab });
    const out = await reg.delete({
      tabId: tab.id,
      requesterId: 'x',
      tenantId: 't1',
    });
    expect(out.deleted).toBe(true);
    expect(await reg.get(tab.id)).toBeNull();
  });

  it('refuses cross-tenant delete', async () => {
    const tab = mkTab();
    await reg.save({ tab });
    const out = await reg.delete({
      tabId: tab.id,
      requesterId: 'x',
      tenantId: 'wrong',
    });
    expect(out.deleted).toBe(false);
  });

  it('size reflects inserts + deletes', async () => {
    expect(await reg.size()).toBe(0);
    await reg.save({ tab: mkTab() });
    expect(await reg.size()).toBe(1);
  });

  it('rejects invalid input via the Zod schema', async () => {
    await expect(
      reg.save({
        tab: { ...mkTab(), tabKey: 'NOT lowercase' } as PortalTab,
      }),
    ).rejects.toThrow();
  });
});

describe('createDrizzleTabRegistry', () => {
  it('issues INSERT on save', async () => {
    const queries: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
    const db = {
      query: vi.fn(async (sql: string, params?: ReadonlyArray<unknown>) => {
        queries.push({ sql, params: params ?? [] });
        return [];
      }),
    };
    const reg = createDrizzleTabRegistry({ db });
    const tab = mkTab();
    await reg.save({ tab });
    expect(queries[0]?.sql).toMatch(/INSERT INTO public\.portal_tabs/);
    expect(queries[0]?.params[0]).toBe(tab.id);
  });

  it('builds the right SELECT for tenant-default list', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    };
    const reg = createDrizzleTabRegistry({ db });
    await reg.list({ tenantId: 't1' });
    expect(queries[0]).toMatch(/tenant_id = \$1/);
    expect(queries[0]).toMatch(/user_id IS NULL/);
  });

  it('parses jsonb rows back into PortalTab', async () => {
    const tab = mkTab();
    const db = {
      query: vi.fn(async () => [
        {
          id: tab.id,
          tenant_id: tab.tenantId,
          user_id: tab.userId,
          tab_key: tab.tabKey,
          schema_version: 1,
          tab,
          parent_tab_id: null,
          created_at: tab.createdAt,
          updated_at: tab.updatedAt,
        },
      ]),
    };
    const reg = createDrizzleTabRegistry({ db });
    const rows = await reg.list({ tenantId: 't1', userId: tab.userId });
    expect(rows.length).toBe(1);
    expect(rows[0]?.tabKey).toBe('hr.payroll');
  });

  it('returns null on missing get()', async () => {
    const db = { query: vi.fn(async () => []) };
    const reg = createDrizzleTabRegistry({ db });
    expect(await reg.get('missing')).toBeNull();
  });

  it('returns deleted=false when nothing matched', async () => {
    const db = { query: vi.fn(async () => []) };
    const reg = createDrizzleTabRegistry({ db });
    const out = await reg.delete({
      tabId: 'x',
      requesterId: 'u',
      tenantId: 't1',
    });
    expect(out.deleted).toBe(false);
  });
});

// vitest globals provide beforeEach without import.
import { beforeEach } from 'vitest';
