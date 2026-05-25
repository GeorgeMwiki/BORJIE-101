import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCodebaseSnapshot,
  buildRepositoryMap,
  buildRepositoryMapCached,
  clearRepositoryMapCache,
  extractSymbolsRegex,
  parseSymbolsWithTreeSitter,
} from './index.js';
import type { TreeSitterParserAdapter } from './index.js';
import { cleanup, createTempDir, writeFixtureFile } from '../__tests__/fixtures/setup.js';

describe('repository-map :: buildCodebaseSnapshot', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir('ocap-snap-');
    await writeFixtureFile(root, 'src/a.ts', `export function alpha() {}\n`);
    await writeFixtureFile(root, 'src/b.ts', `export class Beta {}\n`);
    await writeFixtureFile(root, 'node_modules/skip.ts', `export const X = 1;\n`);
    await writeFixtureFile(root, 'README.md', `# heading\n`);
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it('walks only allowed languages and skips node_modules', async () => {
    const snap = await buildCodebaseSnapshot({ rootDir: root, tokenBudget: 1000 });
    const paths = snap.files.map((f) => f.path).sort();
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
    expect(paths).not.toContain('node_modules/skip.ts');
    expect(paths).not.toContain('README.md');
  });

  it('records language, size, and content hash for each file', async () => {
    const snap = await buildCodebaseSnapshot({ rootDir: root, tokenBudget: 1000 });
    for (const f of snap.files) {
      expect(f.language).toBe('typescript');
      expect(f.size).toBeGreaterThan(0);
      expect(f.contentHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('respects custom excludeDirs', async () => {
    await writeFixtureFile(root, 'private/secret.ts', `export const S = 1;\n`);
    const snap = await buildCodebaseSnapshot({
      rootDir: root,
      tokenBudget: 1000,
      excludeDirs: ['private'],
    });
    expect(snap.files.map((f) => f.path)).not.toContain('private/secret.ts');
  });

  it('respects language allowlist', async () => {
    await writeFixtureFile(root, 'src/script.py', `def foo():\n    pass\n`);
    const snap = await buildCodebaseSnapshot({
      rootDir: root,
      tokenBudget: 1000,
      languages: ['python'],
    });
    const paths = snap.files.map((f) => f.path);
    expect(paths).toContain('src/script.py');
    expect(paths).not.toContain('src/a.ts');
  });
});

describe('repository-map :: extractSymbolsRegex', () => {
  it('extracts TypeScript functions, classes, interfaces and consts', () => {
    const source = [
      '/** does alpha */',
      'export function alpha() {}',
      '',
      'export class Beta {}',
      '',
      'export interface Gamma {}',
      '',
      'export const delta = 1;',
    ].join('\n');
    const syms = extractSymbolsRegex('typescript', source);
    const names = syms.map((s) => s.name).sort();
    expect(names).toEqual(['Beta', 'Gamma', 'alpha', 'delta']);
    const alpha = syms.find((s) => s.name === 'alpha');
    expect(alpha?.kind).toBe('function');
    expect(alpha?.docstring).toContain('does alpha');
  });

  it('extracts Python def + class', () => {
    const source = `def alpha():\n    pass\n\nclass Beta:\n    pass\n`;
    const syms = extractSymbolsRegex('python', source);
    expect(syms.map((s) => s.name).sort()).toEqual(['Beta', 'alpha']);
  });

  it('extracts exported Go functions (uppercase only)', () => {
    const source = `func Public() {}\nfunc private() {}\n`;
    const syms = extractSymbolsRegex('go', source);
    expect(syms.map((s) => s.name)).toEqual(['Public']);
  });

  it('extracts Rust pub items', () => {
    const source = `pub fn alpha() {}\npub struct Beta {}\nfn private() {}\n`;
    const syms = extractSymbolsRegex('rust', source);
    expect(syms.map((s) => s.name).sort()).toEqual(['Beta', 'alpha']);
  });

  it('returns empty for unknown language', () => {
    expect(extractSymbolsRegex('unknown', 'whatever')).toEqual([]);
  });
});

describe('repository-map :: parseSymbolsWithTreeSitter', () => {
  it('delegates to injected adapter', () => {
    const adapter: TreeSitterParserAdapter = {
      extractSymbols: () => [
        { name: 'synthetic', kind: 'function', line: 1 },
      ],
    };
    const out = parseSymbolsWithTreeSitter(adapter, 'typescript', 'irrelevant');
    expect(out.map((s) => s.name)).toEqual(['synthetic']);
  });
});

describe('repository-map :: buildRepositoryMap', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir('ocap-map-');
    await writeFixtureFile(
      root,
      'src/large.ts',
      `/**\n * Big file with many symbols.\n */\n` +
        Array.from({ length: 40 }, (_, i) => `export function f${i}() {}`).join('\n'),
    );
    await writeFixtureFile(
      root,
      'src/small.ts',
      `export function tiny() {}\n`,
    );
    await writeFixtureFile(
      root,
      'src/uses-large.ts',
      `import { f0 } from './large.js';\nexport const u = f0;\n`,
    );
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it('produces a token-budget-respecting map', async () => {
    const map = await buildRepositoryMap({ rootDir: root, tokenBudget: 1000 });
    expect(map.tokenEstimate).toBeLessThanOrEqual(map.tokenBudget);
    expect(map.files.length).toBeGreaterThan(0);
    expect(map.cacheKey).toMatch(/^[0-9a-f]{24}$/);
  });

  it('drops files that overflow the budget', async () => {
    const map = await buildRepositoryMap({ rootDir: root, tokenBudget: 60 });
    expect(map.droppedFiles.length).toBeGreaterThanOrEqual(1);
    // The kept files plus the dropped should equal the total source set.
    const total = map.files.length + map.droppedFiles.length;
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it('records summary, importCount, and tokenEstimate per file', async () => {
    const map = await buildRepositoryMap({ rootDir: root, tokenBudget: 10_000 });
    const large = map.files.find((f) => f.path === 'src/large.ts');
    expect(large?.summary).toContain('Big file');
    const uses = map.files.find((f) => f.path === 'src/uses-large.ts');
    expect(uses?.importCount).toBe(1);
    for (const f of map.files) {
      expect(f.tokenEstimate).toBeGreaterThan(0);
    }
  });

  it('throws on non-positive token budget', async () => {
    await expect(
      buildRepositoryMap({ rootDir: root, tokenBudget: 0 }),
    ).rejects.toThrow(/tokenBudget/);
  });
});

describe('repository-map :: buildRepositoryMapCached', () => {
  let root: string;

  beforeEach(async () => {
    clearRepositoryMapCache();
    root = await createTempDir('ocap-cache-');
    await writeFixtureFile(root, 'src/a.ts', `export const A = 1;\n`);
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it('returns the identical object on repeat calls when source is unchanged', async () => {
    const first = await buildRepositoryMapCached({ rootDir: root, tokenBudget: 1000 });
    const second = await buildRepositoryMapCached({ rootDir: root, tokenBudget: 1000 });
    expect(second).toBe(first);
  });

  it('cache invalidates when content changes', async () => {
    const first = await buildRepositoryMapCached({ rootDir: root, tokenBudget: 1000 });
    await writeFixtureFile(root, 'src/a.ts', `export const A = 2;\n`);
    const second = await buildRepositoryMapCached({ rootDir: root, tokenBudget: 1000 });
    expect(second).not.toBe(first);
    expect(second.cacheKey).not.toBe(first.cacheKey);
  });
});
