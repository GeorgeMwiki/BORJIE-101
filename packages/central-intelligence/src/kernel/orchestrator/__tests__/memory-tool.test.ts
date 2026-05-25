import { describe, it, expect } from 'vitest';
import {
  createInMemoryMemoryTool,
  MemoryPathError,
  MemoryPreconditionError,
  safeMemoryPath,
} from '../memory-tool.js';
import type { ScopeContext } from '../../../types.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures — a tenant + platform scope, plus a deterministic clock so
// the `updatedAt` fields are stable across CI runs.
// ─────────────────────────────────────────────────────────────────────

const tenantScope: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_1',
  actorUserId: 'u_1',
  roles: ['owner'],
  personaId: 'p_1',
};

function frozenClock(): () => Date {
  let n = 0;
  return () => new Date(2026, 0, 1, 0, 0, n++);
}

// ─────────────────────────────────────────────────────────────────────
// Canonical methods — one test per Anthropic `memory_20250818` op.
// ─────────────────────────────────────────────────────────────────────

describe('MemoryTool canonical API', () => {
  it('view() returns the file entry when the path is a file', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    await mt.create('t_1', 'plan.md', 'step 1');
    const result = await mt.view('t_1', 'plan.md');
    expect(result.kind).toBe('file');
    if (result.kind === 'file') {
      expect(result.entry.content).toBe('step 1');
      expect(result.entry.path).toBe('/memories/thread_t_1/plan.md');
    }
  });

  it('view() returns a directory listing when the path is a prefix', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    await mt.create('t_1', 'cache/a.json', 'A');
    await mt.create('t_1', 'cache/b.json', 'B');
    const result = await mt.view('t_1', 'cache');
    expect(result.kind).toBe('directory');
    if (result.kind === 'directory') {
      expect(result.paths.length).toBe(2);
    }
  });

  it('view() returns not-found for unknown paths', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    expect((await mt.view('t_1', 'absent.md')).kind).toBe('not-found');
  });

  it('create() writes a new entry and refuses to overwrite', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    const entry = await mt.create('t_1', 'plan.md', 'first');
    expect(entry.content).toBe('first');
    await expect(mt.create('t_1', 'plan.md', 'second')).rejects.toBeInstanceOf(
      MemoryPreconditionError,
    );
  });

  it('str_replace() rewrites the matched substring', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    await mt.create('t_1', 'plan.md', 'hello WORLD');
    const after = await mt.str_replace('t_1', 'plan.md', 'WORLD', 'orchestrator');
    expect(after.content).toBe('hello orchestrator');
  });

  it('str_replace() rejects when old_str is missing or ambiguous', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    await mt.create('t_1', 'plan.md', 'foo foo bar');
    await expect(
      mt.str_replace('t_1', 'plan.md', 'qux', 'baz'),
    ).rejects.toMatchObject({ code: 'old-str-missing' });
    await expect(
      mt.str_replace('t_1', 'plan.md', 'foo', 'baz'),
    ).rejects.toMatchObject({ code: 'old-str-ambiguous' });
  });

  it('insert() places content at the given 1-based line', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    await mt.create('t_1', 'plan.md', 'a\nb\nc');
    const after = await mt.insert('t_1', 'plan.md', 2, 'NEW');
    expect(after.content).toBe('a\nNEW\nb\nc');
  });

  it('delete() removes a single entry and recurses on directories', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    await mt.create('t_1', 'plan.md', 'p');
    expect(await mt.delete('t_1', 'plan.md')).toBe(true);
    expect(await mt.delete('t_1', 'plan.md')).toBe(false);

    await mt.create('t_1', 'cache/a.json', 'A');
    await mt.create('t_1', 'cache/b.json', 'B');
    expect(await mt.delete('t_1', 'cache')).toBe(true);
    expect((await mt.view('t_1', 'cache')).kind).toBe('not-found');
  });

  it('rename() moves an entry and refuses destination collision', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    await mt.create('t_1', 'plan.md', 'p');
    await mt.rename('t_1', 'plan.md', 'plan-v2.md');
    expect((await mt.view('t_1', 'plan.md')).kind).toBe('not-found');
    expect((await mt.view('t_1', 'plan-v2.md')).kind).toBe('file');
    await mt.create('t_1', 'plan.md', 'rebirth');
    await expect(
      mt.rename('t_1', 'plan.md', 'plan-v2.md'),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Legacy aliases — should still round-trip values written via the
// canonical API. This protects callers that were wired in Phase E.1.
// ─────────────────────────────────────────────────────────────────────

describe('MemoryTool legacy aliases (deprecated)', () => {
  it('read/write/list round-trip values from the canonical store', async () => {
    const mt = createInMemoryMemoryTool(frozenClock());
    // Legacy write() upserts — no `already-exists` error.
    await mt.write('t_1', 'scratch.md', 'one');
    await mt.write('t_1', 'scratch.md', 'two');
    const got = await mt.read('t_1', 'scratch.md');
    expect(got?.content).toBe('two');

    await mt.write('t_1', 'cache/x.json', 'X');
    const listed = await mt.list('t_1', 'cache');
    expect(listed.some((k) => k.endsWith('x.json'))).toBe(true);

    // The canonical recall() still sees both entries.
    const recalled = await mt.recall({ scope: tenantScope });
    expect(recalled.entries.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defence-in-depth — path traversal still rejected.
// ─────────────────────────────────────────────────────────────────────

describe('safeMemoryPath', () => {
  it('rejects path traversal and backslashes', () => {
    expect(() => safeMemoryPath('t_1', '../escape')).toThrow(MemoryPathError);
    expect(() => safeMemoryPath('t_1', 'a\\b')).toThrow(MemoryPathError);
    expect(() => safeMemoryPath('!evil!', 'plan.md')).toThrow(MemoryPathError);
  });
});

// ─────────────────────────────────────────────────────────────────────
// H7 — LRU + TTL bounded growth. A long-running thread that uses
// /memories as scratch must not accumulate unbounded entries.
// ─────────────────────────────────────────────────────────────────────

describe('createInMemoryMemoryTool — H7 bounded growth', () => {
  it('evicts oldest entries when maxEntries cap is exceeded (H7)', async () => {
    let sizeCallbacks = 0;
    const mt = createInMemoryMemoryTool(undefined, {
      maxEntries: 3,
      onSizeChange: () => {
        sizeCallbacks += 1;
      },
    });
    await mt.write('t_1', 'a.md', '1');
    await mt.write('t_1', 'b.md', '2');
    await mt.write('t_1', 'c.md', '3');
    await mt.write('t_1', 'd.md', '4'); // evicts a.md
    const listed = await mt.list('t_1');
    expect(listed.length).toBe(3);
    expect(listed.some((k) => k.endsWith('a.md'))).toBe(false);
    expect(listed.some((k) => k.endsWith('d.md'))).toBe(true);
    expect(sizeCallbacks).toBe(4);
  });

  it('refreshes LRU position on re-write (H7)', async () => {
    const mt = createInMemoryMemoryTool(undefined, { maxEntries: 3 });
    await mt.write('t_1', 'a.md', '1');
    await mt.write('t_1', 'b.md', '2');
    await mt.write('t_1', 'c.md', '3');
    // Re-write a.md — moves it to the tail; b.md is now oldest.
    await mt.write('t_1', 'a.md', '1-updated');
    await mt.write('t_1', 'd.md', '4'); // evicts b.md
    const listed = await mt.list('t_1');
    expect(listed.some((k) => k.endsWith('a.md'))).toBe(true);
    expect(listed.some((k) => k.endsWith('b.md'))).toBe(false);
  });

  it('expires entries past TTL on access (H7)', async () => {
    let nowMs = 1_000_000;
    const clock = (): Date => new Date(nowMs);
    const mt = createInMemoryMemoryTool(clock, {
      maxEntries: 100,
      entryTtlMs: 1000,
    });
    await mt.write('t_1', 'old.md', 'stale');
    nowMs += 5000; // 5s later
    await mt.write('t_1', 'fresh.md', 'recent');
    // recall triggers a TTL sweep before iterating.
    const recalled = await mt.recall({
      scope: {
        kind: 'tenant',
        tenantId: 't_1',
        actorUserId: 'u',
        roles: ['o'],
        personaId: 'p',
      },
    });
    expect(recalled.entries.some((e) => e.path.endsWith('fresh.md'))).toBe(true);
    expect(recalled.entries.some((e) => e.path.endsWith('old.md'))).toBe(false);
  });
});
