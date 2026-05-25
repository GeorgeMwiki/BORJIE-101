/**
 * Unit tests for `episodic-amem.ts` — writeNote + recall + helpers.
 *
 * Uses an in-memory `EpisodicRepo` fake so the tests are pure CPU.
 */

import { describe, expect, it } from 'vitest';
import {
  PARENT_LINK_COSINE_THRESHOLD,
  computeImportance,
  containsMoney,
  cosineSimilarity,
  recall,
  writeNote,
} from '../episodic-amem.js';
import type { EpisodicNote, EpisodicRepo } from '../types-amem.js';

interface MutableRepo extends EpisodicRepo {
  readonly rows: Map<string, EpisodicNote>;
}

function makeFakeRepo(): MutableRepo {
  const rows = new Map<string, EpisodicNote>();
  let counter = 0;
  const repo: MutableRepo = {
    rows,
    generateId: () => `id_${++counter}`,
    now: () => new Date('2026-05-21T00:00:00Z'),
    async insert(note: EpisodicNote): Promise<void> {
      rows.set(note.id, note);
    },
    async findCandidates(args): Promise<ReadonlyArray<EpisodicNote>> {
      const out: EpisodicNote[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== args.tenantId) continue;
        if (row.sessionId !== args.sessionId) continue;
        out.push(row);
        if (out.length >= args.limit) break;
      }
      return out;
    },
    async searchByEmbedding(args): Promise<ReadonlyArray<EpisodicNote>> {
      const candidates: { row: EpisodicNote; sim: number }[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== args.tenantId) continue;
        if (row.softDeletedAt) continue;
        const sim = cosineSimilarity(args.embedding, row.embedding);
        candidates.push({ row, sim });
      }
      candidates.sort((a, b) => b.sim - a.sim);
      return candidates.slice(0, args.limit).map((c) => c.row);
    },
    async bumpAccess({ ids }): Promise<void> {
      for (const id of ids) {
        const row = rows.get(id);
        if (row) {
          rows.set(id, {
            ...row,
            accessCount: row.accessCount + 1,
          });
        }
      }
    },
  };
  return repo;
}

const fakeEmbedder =
  (vec: ReadonlyArray<number>) =>
  async (_text: string): Promise<ReadonlyArray<number>> => vec;

describe('containsMoney', (): void => {
  it('detects currency codes', (): void => {
    expect(containsMoney(['paid TZS 450,000 today'])).toBe(true);
    expect(containsMoney(['monthly rent KES 12,000'])).toBe(true);
    expect(containsMoney(['$1,200 deposit'])).toBe(true);
  });
  it('detects "rent of <amount>"', (): void => {
    expect(containsMoney(['the rent of 450000 is overdue'])).toBe(true);
  });
  it('returns false for non-monetary facts', (): void => {
    expect(containsMoney(['the kitchen faucet is leaking'])).toBe(false);
    expect(containsMoney([])).toBe(false);
  });
});

describe('computeImportance', (): void => {
  it('returns base score with no links and no money', (): void => {
    expect(computeImportance(0, false)).toBeCloseTo(0.4, 5);
  });
  it('adds 0.1 per link and 0.2 for money', (): void => {
    expect(computeImportance(2, true)).toBeCloseTo(0.4 + 0.2 + 0.2, 5);
  });
  it('clamps at 1.0', (): void => {
    expect(computeImportance(100, true)).toBe(1);
  });
  it('clamps at 0', (): void => {
    expect(computeImportance(-5, false)).toBe(0.4);
  });
});

describe('cosineSimilarity', (): void => {
  it('returns 1 for identical unit vectors', (): void => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });
  it('returns 0 for orthogonal vectors', (): void => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it('returns 0 for mismatched lengths', (): void => {
    expect(cosineSimilarity([1, 0], [0, 1, 0])).toBe(0);
  });
  it('returns 0 for empty vectors', (): void => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('writeNote', (): void => {
  it('writes a note with default importance when no parents', async (): Promise<void> => {
    const repo = makeFakeRepo();
    const note = await writeNote(
      'tenant-A',
      'session-1',
      0,
      { kind: 'user-message' },
      ['hello world'],
      fakeEmbedder([1, 0, 0]),
      repo,
    );
    expect(note.tenantId).toBe('tenant-A');
    expect(note.sessionId).toBe('session-1');
    expect(note.facts).toEqual(['hello world']);
    expect(note.parents).toEqual([]);
    expect(note.importanceScore).toBeCloseTo(0.4, 5);
    expect(repo.rows.size).toBe(1);
  });

  it('links parents at cosine >= 0.8 and bumps importance', async (): Promise<void> => {
    const repo = makeFakeRepo();
    // Seed a near-identical parent note.
    await writeNote(
      'tenant-A',
      'session-1',
      0,
      { kind: 'user-message' },
      ['the rent for unit 4B is TZS 450,000'],
      fakeEmbedder([1, 0, 0]),
      repo,
    );
    // Second note — identical embedding triggers a parent link.
    const note = await writeNote(
      'tenant-A',
      'session-1',
      1,
      { kind: 'agent-action' },
      ['confirmed rent payment TZS 450,000'],
      fakeEmbedder([1, 0, 0]),
      repo,
    );
    expect(note.parents.length).toBe(1);
    // Importance = base 0.4 + 1 link * 0.1 + money 0.2 = 0.7
    expect(note.importanceScore).toBeCloseTo(0.7, 5);
  });

  it('does NOT link when cosine < threshold', async (): Promise<void> => {
    const repo = makeFakeRepo();
    await writeNote(
      'tenant-A',
      'session-1',
      0,
      {},
      ['unrelated topic'],
      fakeEmbedder([1, 0, 0]),
      repo,
    );
    const note = await writeNote(
      'tenant-A',
      'session-1',
      1,
      {},
      ['totally different'],
      fakeEmbedder([0, 1, 0]), // orthogonal → cosine = 0
      repo,
    );
    expect(note.parents).toEqual([]);
  });

  it('throws when embedder or repo is missing', async (): Promise<void> => {
    const repo = makeFakeRepo();
    await expect(
      writeNote(
        't',
        's',
        0,
        {},
        ['x'],
        undefined as unknown as Parameters<typeof writeNote>[5],
        repo,
      ),
    ).rejects.toThrow(/embedder/);
  });

  it('exports the documented threshold', (): void => {
    expect(PARENT_LINK_COSINE_THRESHOLD).toBe(0.8);
  });
});

describe('recall', (): void => {
  it('returns top-k by cosine similarity', async (): Promise<void> => {
    const repo = makeFakeRepo();
    // Seed three notes with varying embeddings.
    await writeNote('t', 's', 0, {}, ['near'], fakeEmbedder([1, 0]), repo);
    await writeNote('t', 's', 1, {}, ['far'], fakeEmbedder([0, 1]), repo);
    await writeNote(
      't',
      's',
      2,
      {},
      ['mid'],
      fakeEmbedder([0.7, 0.3]),
      repo,
    );
    const out = await recall('t', 'query', 2, fakeEmbedder([1, 0]), repo);
    expect(out.length).toBe(2);
    expect(out[0].facts).toEqual(['near']);
  });

  it('bumps access_count on recalled rows', async (): Promise<void> => {
    const repo = makeFakeRepo();
    const seeded = await writeNote(
      't',
      's',
      0,
      {},
      ['hello'],
      fakeEmbedder([1, 0]),
      repo,
    );
    expect(seeded.accessCount).toBe(0);
    await recall('t', 'q', 5, fakeEmbedder([1, 0]), repo);
    expect(repo.rows.get(seeded.id)?.accessCount).toBe(1);
  });

  it('returns empty for empty query', async (): Promise<void> => {
    const repo = makeFakeRepo();
    const out = await recall('t', '   ', 5, fakeEmbedder([1, 0]), repo);
    expect(out).toEqual([]);
  });

  it('clamps k to [1, 50]', async (): Promise<void> => {
    const repo = makeFakeRepo();
    await writeNote('t', 's', 0, {}, ['x'], fakeEmbedder([1, 0]), repo);
    const tooBig = await recall(
      't',
      'q',
      9999,
      fakeEmbedder([1, 0]),
      repo,
    );
    expect(tooBig.length).toBeLessThanOrEqual(50);
  });
});
