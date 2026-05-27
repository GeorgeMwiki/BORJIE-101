import { describe, it, expect } from 'vitest';
import { createInMemoryPostQualityScoresRepository } from '../repositories/post-quality-scores-repository.js';
import {
  cosineSimilarity,
  createInMemorySearchIndexRepository,
  rankCoverage,
  tokenise,
} from '../repositories/search-index-repository.js';
import { BlackboardIntelError, type PostQualityScore } from '../types.js';

function makeScore(
  overrides: Partial<PostQualityScore> = {},
): PostQualityScore {
  return Object.freeze({
    id: 'sc-1',
    tenantId: 'tenant-a',
    postId: 'post-1',
    axis: 'groundedness',
    score: 1.0,
    scoredAt: '2026-05-27T10:00:00.000Z',
    prevHash: '',
    auditHash: 'h-1',
    ...overrides,
  });
}

describe('post-quality-scores in-memory repository', () => {
  it('insert + listForPost round-trips a single row', async () => {
    const repo = createInMemoryPostQualityScoresRepository();
    await repo.insert(makeScore());
    const rows = await repo.listForPost('tenant-a', 'post-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('sc-1');
  });

  it('rejects out-of-range scores', async () => {
    const repo = createInMemoryPostQualityScoresRepository();
    await expect(
      repo.insert(makeScore({ score: 1.5 })),
    ).rejects.toBeInstanceOf(BlackboardIntelError);
    await expect(
      repo.insert(makeScore({ score: -0.1 })),
    ).rejects.toBeInstanceOf(BlackboardIntelError);
  });

  it('rejects duplicate ids', async () => {
    const repo = createInMemoryPostQualityScoresRepository();
    await repo.insert(makeScore());
    await expect(repo.insert(makeScore())).rejects.toBeInstanceOf(
      BlackboardIntelError,
    );
  });

  it('tipPerAxis returns the newest row per axis', async () => {
    const repo = createInMemoryPostQualityScoresRepository();
    await repo.insert(
      makeScore({
        id: 'sc-old',
        axis: 'groundedness',
        score: 0.5,
        scoredAt: '2026-05-27T09:00:00.000Z',
      }),
    );
    await repo.insert(
      makeScore({
        id: 'sc-new',
        axis: 'groundedness',
        score: 1.0,
        scoredAt: '2026-05-27T11:00:00.000Z',
      }),
    );
    const tip = await repo.tipPerAxis('tenant-a', 'post-1');
    expect(tip['groundedness']?.id).toBe('sc-new');
  });
});

describe('search-index in-memory helpers', () => {
  it('tokenise lowercases and splits on non-word characters', () => {
    const tokens = tokenise('Fuel-7 Spike! at 04:30');
    expect(tokens.has('fuel')).toBe(true);
    expect(tokens.has('7')).toBe(true);
    expect(tokens.has('spike')).toBe(true);
    expect(tokens.has('at')).toBe(true);
    expect(tokens.has('04')).toBe(true);
    expect(tokens.has('30')).toBe(true);
  });

  it('rankCoverage favours shorter posts on the same hit count', () => {
    const q = tokenise('fuel spike');
    const shortPost = tokenise('fuel spike');
    const longPost = tokenise('fuel spike on loader during night shift');
    expect(rankCoverage(q, shortPost)).toBeGreaterThan(
      rankCoverage(q, longPost),
    );
  });

  it('cosineSimilarity returns 0 for orthogonal vectors and 1 for parallel', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1, 6);
  });

  it('search-index in-memory repository round-trips upsert + ftsSearch', async () => {
    const repo = createInMemorySearchIndexRepository();
    await repo.upsert({
      postId: 'p1',
      tenantId: 'tenant-a',
      content: 'fuel spike on loader-7',
      auditHash: 'h1',
    });
    const hits = await repo.ftsSearch('tenant-a', 'fuel loader', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.postId).toBe('p1');
    expect(await repo.getContent('tenant-a', 'p1')).toContain('fuel');
    // Cross-tenant getContent must return null.
    expect(await repo.getContent('tenant-b', 'p1')).toBeNull();
  });
});
