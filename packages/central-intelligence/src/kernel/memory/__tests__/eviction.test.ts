/**
 * Unit tests for `eviction.ts` — FadeMem decay + sweeps.
 *
 * Covers the math and both code paths (SQL-side delegation vs in-memory
 * fallback).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HARD_EVICT_DAYS,
  DEFAULT_SOFT_DELETE_THRESHOLD,
  FADEMEM_DECAY_RATE,
  MS_PER_DAY,
  effectiveScore,
  hardEvictSweep,
  runEvictionSweep,
  softDeleteSweep,
} from '../eviction.js';
import type { EpisodicNote, EpisodicRepo } from '../types-amem.js';

function makeNote(over: Partial<EpisodicNote> = {}): EpisodicNote {
  return {
    id: 'n1',
    tenantId: 't',
    sessionId: 's',
    turnIdx: 0,
    event: {},
    facts: [],
    embedding: [],
    importanceScore: 0.5,
    parents: [],
    accessCount: 0,
    createdAt: new Date('2026-05-21T00:00:00Z'),
    lastAccessedAt: new Date('2026-05-21T00:00:00Z'),
    softDeletedAt: null,
    ...over,
  };
}

describe('effectiveScore', (): void => {
  it('returns importance when age=0 and accessCount=0', (): void => {
    const note = makeNote({
      importanceScore: 0.5,
      createdAt: new Date('2026-05-21T00:00:00Z'),
    });
    const score = effectiveScore(note, new Date('2026-05-21T00:00:00Z'));
    expect(score).toBeCloseTo(0.5, 5);
  });

  it('halves after 30 days (half-life)', (): void => {
    const created = new Date('2026-01-01T00:00:00Z');
    const now = new Date(created.getTime() + 30 * MS_PER_DAY);
    const note = makeNote({ importanceScore: 1, createdAt: created });
    const score = effectiveScore(note, now);
    // exp(-0.0231 * 30) = exp(-0.693) ≈ 0.5
    expect(score).toBeCloseTo(0.5, 2);
  });

  it('LFU bonus rises with access_count', (): void => {
    const note0 = makeNote({ accessCount: 0, importanceScore: 0.5 });
    const note10 = makeNote({ accessCount: 10, importanceScore: 0.5 });
    const note100 = makeNote({ accessCount: 100, importanceScore: 0.5 });
    const now = note0.createdAt;
    expect(effectiveScore(note10, now)).toBeGreaterThan(
      effectiveScore(note0, now),
    );
    expect(effectiveScore(note100, now)).toBeGreaterThan(
      effectiveScore(note10, now),
    );
  });

  it('handles snake_case row shapes from SQL', (): void => {
    const row = {
      importance_score: 0.5,
      created_at: '2026-05-21T00:00:00Z',
      access_count: 3,
    };
    const now = new Date('2026-05-21T00:00:00Z');
    const score = effectiveScore(row, now);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 for malformed inputs', (): void => {
    const score = effectiveScore(
      // @ts-expect-error - testing runtime safety
      { importance_score: 'nope', created_at: null },
      new Date(),
    );
    expect(score).toBe(0);
  });

  it('exports the documented decay rate', (): void => {
    expect(FADEMEM_DECAY_RATE).toBeCloseTo(0.0231, 4);
  });
});

describe('softDeleteSweep', (): void => {
  it('delegates to repo.softDeleteBelow when available', async (): Promise<void> => {
    let called = false;
    const repo: EpisodicRepo = {
      async insert(): Promise<void> {
        /* unused */
      },
      async findCandidates(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async searchByEmbedding(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async softDeleteBelow(): Promise<number> {
        called = true;
        return 42;
      },
    };
    const out = await softDeleteSweep(repo, { threshold: 0.1 });
    expect(called).toBe(true);
    expect(out).toBe(42);
  });

  it('falls back to in-memory iteration when no SQL helper', async (): Promise<void> => {
    const oldDate = new Date('2025-01-01T00:00:00Z'); // very old
    const repo: EpisodicRepo = {
      async insert(): Promise<void> {
        /* unused */
      },
      async findCandidates(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async searchByEmbedding(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async streamAll(): Promise<ReadonlyArray<EpisodicNote>> {
        return [
          makeNote({ id: 'high', importanceScore: 0.9 }),
          makeNote({
            id: 'low',
            importanceScore: 0.05,
            createdAt: oldDate,
          }),
        ];
      },
    };
    const out = await softDeleteSweep(repo, {
      threshold: 0.1,
      now: new Date('2026-05-21T00:00:00Z'),
    });
    expect(out).toBe(1); // only the 'low' one falls below the floor
  });

  it('returns 0 when neither helper is wired', async (): Promise<void> => {
    const repo: EpisodicRepo = {
      async insert(): Promise<void> {
        /* unused */
      },
      async findCandidates(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async searchByEmbedding(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
    };
    const out = await softDeleteSweep(repo);
    expect(out).toBe(0);
  });
});

describe('hardEvictSweep', (): void => {
  it('counts soft-deleted notes older than the window', async (): Promise<void> => {
    const longAgo = new Date('2026-01-01T00:00:00Z');
    const repo: EpisodicRepo = {
      async insert(): Promise<void> {
        /* unused */
      },
      async findCandidates(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async searchByEmbedding(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async streamAll(): Promise<ReadonlyArray<EpisodicNote>> {
        return [
          makeNote({ id: 'live', softDeletedAt: null }),
          makeNote({ id: 'recent', softDeletedAt: new Date('2026-05-15T00:00:00Z') }),
          makeNote({ id: 'old', softDeletedAt: longAgo }),
        ];
      },
    };
    const out = await hardEvictSweep(repo, {
      olderThanDays: 90,
      now: new Date('2026-05-21T00:00:00Z'),
    });
    expect(out).toBe(1); // only 'old' (jan 1 → may 21 = ~140 days)
  });

  it('exposes the 90-day default', (): void => {
    expect(DEFAULT_HARD_EVICT_DAYS).toBe(90);
  });
});

describe('runEvictionSweep', (): void => {
  it('returns combined counts from both sweeps', async (): Promise<void> => {
    const repo: EpisodicRepo = {
      async insert(): Promise<void> {
        /* unused */
      },
      async findCandidates(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async searchByEmbedding(): Promise<ReadonlyArray<EpisodicNote>> {
        return [];
      },
      async softDeleteBelow(): Promise<number> {
        return 5;
      },
      async hardDeleteOlderThan(): Promise<number> {
        return 2;
      },
    };
    const out = await runEvictionSweep(repo);
    expect(out).toEqual({ softDeleted: 5, hardDeleted: 2 });
  });

  it('exposes documented defaults', (): void => {
    expect(DEFAULT_SOFT_DELETE_THRESHOLD).toBe(0.1);
  });
});
