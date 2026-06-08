/**
 * Mount registry + progressive-disclosure loader.
 *
 * Proves the three lane acceptance criteria at the package level:
 *   1. a service mounts as MCP (factory -> live server -> client handshake);
 *   2. progressive disclosure lists names cheaply and loads only a subset;
 *   3. the registry resolves organs by id/project/kind.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createMCPServer, type MCPServer } from '../server/index.js';
import type { SessionContext, ToolDefinition } from '../types.js';
import {
  createMountRegistry,
  createProgressiveDisclosure,
  disclosurePath,
  splitDisclosurePath,
  type MountableServer,
} from '../mount-registry/index.js';

const CTX: SessionContext = Object.freeze({
  sessionId: 'sess-1',
  tenantId: 'tenant-a',
});

function tool(name: string, description: string): ToolDefinition<unknown, unknown> {
  return {
    name,
    description,
    inputSchema: z.object({ q: z.string().optional() }),
    handler: async (args: unknown) => ({
      content: [{ type: 'text', text: `${name}:${JSON.stringify(args)}` }],
    }),
  };
}

function makeServer(name: string, toolNames: ReadonlyArray<string>): MCPServer {
  return createMCPServer({
    name,
    version: '1.0.0',
    tools: toolNames.map((t) => tool(t, `${name} tool ${t}`)),
  });
}

function entry(
  id: string,
  toolNames: ReadonlyArray<string>,
  extra?: Partial<MountableServer>,
): MountableServer {
  return {
    id,
    name: `${id} service`,
    project: 'borjie',
    kind: 'service',
    factory: () => makeServer(id, toolNames),
    ...extra,
  };
}

describe('createMountRegistry', () => {
  it('registers, lists, and resolves organs by id/project/kind', () => {
    const reg = createMountRegistry([
      entry('payments', ['list_ledger']),
      entry('geology', ['list_samples'], {
        project: 'bossnyumba',
        kind: 'domain-server',
        mirrors: 'bn-geology',
      }),
    ]);
    expect(reg.list().map((e) => e.id).sort()).toEqual(['geology', 'payments']);
    expect(reg.has('payments')).toBe(true);
    expect(reg.has('nope')).toBe(false);
    expect(reg.get('geology')?.mirrors).toBe('bn-geology');
    expect(reg.byProject('borjie').map((e) => e.id)).toEqual(['payments']);
    expect(reg.byProject('bossnyumba').map((e) => e.id)).toEqual(['geology']);
    expect(reg.byKind('domain-server').map((e) => e.id)).toEqual(['geology']);
  });

  it('rejects duplicate and namespacing-unsafe ids', () => {
    const reg = createMountRegistry();
    reg.register(entry('ok', ['t']));
    expect(() => reg.register(entry('ok', ['t']))).toThrow(/already registered/);
    expect(() => reg.register(entry('bad.id', ['t']))).toThrow(/namespacing-safe/);
  });

  it('mounts a service as a live MCP server the MD calls through', async () => {
    const reg = createMountRegistry([entry('payments', ['list_ledger'])]);
    const mounted = await reg.mount('payments', CTX);
    try {
      const tools = await mounted.client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['list_ledger']);
      const res = await mounted.client.callTool('list_ledger', { q: 'x' });
      const block = res.content[0] as { type: string; text: string };
      expect(block.text).toContain('list_ledger');
    } finally {
      await mounted.detach();
    }
  });

  it('throws when mounting an unknown organ', async () => {
    const reg = createMountRegistry();
    await expect(reg.mount('ghost', CTX)).rejects.toThrow(/No mountable organ/);
  });
});

describe('progressive disclosure (tools-as-/proc-filesystem)', () => {
  function bigRegistry() {
    // 5 organs, 4 tools each = 20 tools — simulates the 50+ juniors case.
    const entries: MountableServer[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `organ${i}`;
      entries.push(entry(id, ['a', 'b', 'c', 'd']));
    }
    return createMountRegistry(entries);
  }

  it('lists organs without paging any tool spec (ls /)', () => {
    const pd = createProgressiveDisclosure(bigRegistry());
    const organs = pd.listOrgans();
    expect(organs.length).toBe(5);
    expect(organs[0]).not.toHaveProperty('inputSchema');
  });

  it('lists every tool path as names only (ls -R)', async () => {
    const pd = createProgressiveDisclosure(bigRegistry());
    const all = await pd.listAllTools(CTX);
    expect(all.length).toBe(20);
    // names only — no schema field on a path entry
    expect(all[0]).not.toHaveProperty('inputSchema');
    expect(all.map((e) => e.path)).toContain('organ0/a');
  });

  it('respects maxOrgans + organIds filters when listing', async () => {
    const pd = createProgressiveDisclosure(bigRegistry());
    const bounded = await pd.listAllTools(CTX, { maxOrgans: 2 });
    expect(bounded.length).toBe(8);
    const scoped = await pd.listAllTools(CTX, { organIds: ['organ3'] });
    expect(scoped.every((e) => e.organId === 'organ3')).toBe(true);
    expect(scoped.length).toBe(4);
  });

  it('loads (cat) the FULL spec for only the requested subset', async () => {
    const pd = createProgressiveDisclosure(bigRegistry());
    const want = [
      disclosurePath('organ0', 'a'),
      disclosurePath('organ2', 'c'),
      disclosurePath('organ4', 'd'),
    ];
    const specs = await pd.load(want, CTX);
    expect(specs.length).toBe(3);
    for (const s of specs) {
      expect(s.inputSchema).toBeTypeOf('object');
      expect(s.description).toContain('tool');
    }
    expect(specs.map((s) => s.path).sort()).toEqual([
      'organ0/a',
      'organ2/c',
      'organ4/d',
    ]);
  });

  it('stat returns a one-line summary for a single path', async () => {
    const pd = createProgressiveDisclosure(bigRegistry());
    const s = await pd.stat('organ1/b', CTX);
    expect(s?.path).toBe('organ1/b');
    expect(s?.summary).toContain('organ1.b');
    expect(await pd.stat('organ1/missing', CTX)).toBeNull();
    expect(await pd.stat('malformed', CTX)).toBeNull();
  });

  it('skips an injured organ (failing factory) when listing all', async () => {
    const reg = createMountRegistry([
      entry('healthy', ['a', 'b']),
      {
        id: 'injured',
        name: 'injured service',
        project: 'borjie',
        kind: 'service',
        factory: () => {
          throw new Error('limb is broken');
        },
      },
    ]);
    const pd = createProgressiveDisclosure(reg);
    const all = await pd.listAllTools(CTX);
    expect(all.every((e) => e.organId === 'healthy')).toBe(true);
    expect(all.length).toBe(2);
  });

  it('path helpers round-trip', () => {
    expect(disclosurePath('org', 'tool')).toBe('org/tool');
    expect(splitDisclosurePath('org/tool')).toEqual({
      organId: 'org',
      toolName: 'tool',
    });
    expect(splitDisclosurePath('notapath')).toBeNull();
    expect(splitDisclosurePath('/leading')).toBeNull();
    expect(splitDisclosurePath('trailing/')).toBeNull();
  });
});
