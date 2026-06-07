/**
 * Memory brain-tools tests — verify the owner-facing durable memory tools
 * round-trip against a REAL MemoryTool backend (the kernel's in-memory adapter
 * stands in for the Drizzle one; both satisfy the same port):
 *
 *   1. set → get round-trips the stored value + emits memory:<path> evidence.
 *   2. get on a missing key returns a typed not_found (never an invented note).
 *   3. set is upsert — re-using a key overwrites.
 *   4. list returns owner-facing keys (storage path stripped), prefix-filtered.
 *   5. delete removes a note; delete on a missing key returns not_found.
 *   6. tenant isolation — tenant A cannot read tenant B's note.
 *   7. descriptors are persona-gated to owner/admin/manager and carry the
 *      right write/stakes flags.
 */

import { describe, it, expect } from 'vitest';
import { orchestrator } from '@borjie/central-intelligence';
import { buildMemoryTools } from '../brain-tools/memory-tools';
import type { PersonaToolDescriptor } from '../brain-tools/types';

const { createInMemoryMemoryTool } = orchestrator;

function ctxFor(tenantId: string) {
  return {
    tenantId,
    actorId: 'user-1',
    personaSlug: 'T1_owner_strategist',
  };
}

type AnyDesc = PersonaToolDescriptor<
  import('zod').ZodTypeAny,
  import('zod').ZodTypeAny
>;

function byId(
  tools: ReadonlyArray<AnyDesc>,
  id: string,
): AnyDesc {
  const t = tools.find((d) => d.id === id);
  if (!t) throw new Error(`tool ${id} not found`);
  return t;
}

describe('memory brain tools — round trip', () => {
  it('set → get round-trips the value with evidence', async () => {
    const tools = buildMemoryTools(createInMemoryMemoryTool());
    const set = byId(tools, 'mwikila.memory.set');
    const get = byId(tools, 'mwikila.memory.get');

    const setRes = (await set.handler(
      { key: 'geita-flood', value: 'Geita pit floods every March' },
      ctxFor('tenant-a'),
    )) as { status: string; evidenceIds: string[]; updatedAt: string };
    expect(setRes.status).toBe('ok');
    expect(setRes.evidenceIds[0]).toMatch(/^memory:\/memories\/thread_tenant-a\//);

    const getRes = (await get.handler(
      { key: 'geita-flood' },
      ctxFor('tenant-a'),
    )) as { status: string; value: string | null; evidenceIds: string[] };
    expect(getRes.status).toBe('ok');
    expect(getRes.value).toBe('Geita pit floods every March');
    expect(getRes.evidenceIds).toHaveLength(1);
  });

  it('get on a missing key returns not_found (no invented note)', async () => {
    const tools = buildMemoryTools(createInMemoryMemoryTool());
    const get = byId(tools, 'mwikila.memory.get');
    const res = (await get.handler({ key: 'nope' }, ctxFor('tenant-a'))) as {
      status: string;
      value: string | null;
      evidenceIds: string[];
    };
    expect(res.status).toBe('not_found');
    expect(res.value).toBeNull();
    expect(res.evidenceIds).toEqual([]);
  });

  it('set is upsert — re-using a key overwrites', async () => {
    const tools = buildMemoryTools(createInMemoryMemoryTool());
    const set = byId(tools, 'mwikila.memory.set');
    const get = byId(tools, 'mwikila.memory.get');
    await set.handler({ key: 'k', value: 'v1' }, ctxFor('t'));
    await set.handler({ key: 'k', value: 'v2' }, ctxFor('t'));
    const res = (await get.handler({ key: 'k' }, ctxFor('t'))) as {
      value: string | null;
    };
    expect(res.value).toBe('v2');
  });

  it('list returns owner-facing keys, prefix-filtered', async () => {
    const tools = buildMemoryTools(createInMemoryMemoryTool());
    const set = byId(tools, 'mwikila.memory.set');
    const list = byId(tools, 'mwikila.memory.list');
    await set.handler({ key: 'site-a', value: '1' }, ctxFor('t'));
    await set.handler({ key: 'site-b', value: '2' }, ctxFor('t'));
    await set.handler({ key: 'vendor-x', value: '3' }, ctxFor('t'));

    const all = (await list.handler({ limit: 100 }, ctxFor('t'))) as {
      keys: string[];
      count: number;
    };
    expect(all.count).toBe(3);
    expect(all.keys.sort()).toEqual(['site-a', 'site-b', 'vendor-x']);

    const filtered = (await list.handler(
      { prefix: 'site-', limit: 100 },
      ctxFor('t'),
    )) as { keys: string[] };
    expect(filtered.keys.sort()).toEqual(['site-a', 'site-b']);
  });

  it('delete removes a note; missing key → not_found', async () => {
    const tools = buildMemoryTools(createInMemoryMemoryTool());
    const set = byId(tools, 'mwikila.memory.set');
    const get = byId(tools, 'mwikila.memory.get');
    const del = byId(tools, 'mwikila.memory.delete');

    await set.handler({ key: 'temp', value: 'x' }, ctxFor('t'));
    const d1 = (await del.handler({ key: 'temp' }, ctxFor('t'))) as {
      status: string;
    };
    expect(d1.status).toBe('deleted');
    const after = (await get.handler({ key: 'temp' }, ctxFor('t'))) as {
      status: string;
    };
    expect(after.status).toBe('not_found');

    const d2 = (await del.handler({ key: 'temp' }, ctxFor('t'))) as {
      status: string;
    };
    expect(d2.status).toBe('not_found');
  });

  it('isolates memory across tenants', async () => {
    // A SHARED backend instance — isolation must come from the thread-key
    // scoping (ctx.tenantId), not from separate stores.
    const tools = buildMemoryTools(createInMemoryMemoryTool());
    const set = byId(tools, 'mwikila.memory.set');
    const get = byId(tools, 'mwikila.memory.get');

    await set.handler({ key: 'secret', value: 'A-only' }, ctxFor('tenant-a'));
    const crossRead = (await get.handler(
      { key: 'secret' },
      ctxFor('tenant-b'),
    )) as { status: string };
    expect(crossRead.status).toBe('not_found');

    const ownRead = (await get.handler(
      { key: 'secret' },
      ctxFor('tenant-a'),
    )) as { value: string | null };
    expect(ownRead.value).toBe('A-only');
  });
});

describe('memory brain tools — descriptor metadata', () => {
  it('are persona-gated and carry correct write/stakes flags', () => {
    const tools = buildMemoryTools(createInMemoryMemoryTool());
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual([
      'mwikila.memory.delete',
      'mwikila.memory.get',
      'mwikila.memory.list',
      'mwikila.memory.set',
    ]);
    for (const t of tools) {
      expect(t.personaSlugs).toEqual([
        'T1_owner_strategist',
        'T2_admin_strategist',
        'T3_module_manager',
      ]);
      expect(t.stakes).toBe('LOW');
      expect(t.requiresPolicyRuleLiteral).toBe(false);
    }
    expect(byId(tools, 'mwikila.memory.set').isWrite).toBe(true);
    expect(byId(tools, 'mwikila.memory.delete').isWrite).toBe(true);
    expect(byId(tools, 'mwikila.memory.get').isWrite).toBe(false);
    expect(byId(tools, 'mwikila.memory.list').isWrite).toBe(false);
  });
});
