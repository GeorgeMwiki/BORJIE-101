import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryStore, encodeProjectPath, getMemoryDir } from '../memory/index.js';

let tmpRoot: string;
let memoryRoot: string;
const projectPath = '/Users/test/proj-x';

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'agent-runtime-mem-'));
  memoryRoot = join(tmpRoot, 'projects');
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('encoding helpers', () => {
  it('encodes the project path Claude-Code style', () => {
    expect(encodeProjectPath('/Users/test/proj-x')).toBe('Users-test-proj-x');
  });
  it('resolves the memory dir under the given root', () => {
    const dir = getMemoryDir('/Users/test/proj-x', memoryRoot);
    expect(dir).toBe(join(memoryRoot, 'Users-test-proj-x', 'memory'));
  });
});

describe('MemoryStore', () => {
  it('readMemoryIndex on a fresh dir returns empty entries', async () => {
    const store = new MemoryStore({ projectPath, memoryRoot });
    const idx = await store.readMemoryIndex();
    expect(idx.entries).toEqual([]);
  });

  it('writeMemoryEntry persists with frontmatter and updates MEMORY.md', async () => {
    const store = new MemoryStore({ projectPath, memoryRoot });
    const entry = await store.writeMemoryEntry({
      name: 'build-cmd',
      type: 'workflow',
      content: 'Use pnpm build in the api-gateway service',
      tags: ['build', 'gateway'],
    });
    expect(entry.createdAt).toBeDefined();
    expect(entry.tags).toEqual(['build', 'gateway']);

    const file = await readFile(
      join(memoryRoot, 'Users-test-proj-x', 'memory', 'build-cmd.md'),
      'utf8',
    );
    expect(file).toContain('type: workflow');
    expect(file).toContain('Use pnpm build');

    const memMd = await readFile(
      join(memoryRoot, 'Users-test-proj-x', 'memory', 'MEMORY.md'),
      'utf8',
    );
    expect(memMd).toContain('[build-cmd](./build-cmd.md)');
    expect(memMd).toContain('**workflow**');
  });

  it('searchMemory finds matches by substring', async () => {
    const store = new MemoryStore({ projectPath, memoryRoot });
    await store.writeMemoryEntry({
      name: 'pref-color',
      type: 'preference',
      content: 'I prefer dark mode in the dashboard',
    });
    const hits = await store.searchMemory('dark mode');
    expect(hits.map((h) => h.name)).toContain('pref-color');
  });

  it('searchMemory supports regex too', async () => {
    const store = new MemoryStore({ projectPath, memoryRoot });
    const hits = await store.searchMemory('pref-.*');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('forgetMemory removes a file and updates the index', async () => {
    const store = new MemoryStore({ projectPath, memoryRoot });
    const wasDeleted = await store.forgetMemory('build-cmd');
    expect(wasDeleted).toBe(true);
    const idx = await store.readMemoryIndex();
    expect(idx.entries.map((e) => e.name)).not.toContain('build-cmd');
  });

  it('forgetMemory returns false for unknown entry', async () => {
    const store = new MemoryStore({ projectPath, memoryRoot });
    expect(await store.forgetMemory('never-existed')).toBe(false);
  });

  it('rejects unsafe entry names', async () => {
    const store = new MemoryStore({ projectPath, memoryRoot });
    await expect(
      store.writeMemoryEntry({ name: '../escape', type: 'fact', content: 'pwned' }),
    ).rejects.toThrow(/unsafe/);
  });
});
