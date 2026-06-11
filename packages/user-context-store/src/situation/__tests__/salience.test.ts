/**
 * Salience scoring tests — Generative-Agents retrieval recipe.
 */
import { describe, expect, it } from 'vitest';
import { salience, DEFAULT_HALF_LIFE_HOURS, type SalienceContext } from '../salience.js';

const NOW = new Date('2026-06-08T12:00:00Z');
const ctx: SalienceContext = { now: () => NOW };

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

describe('salience', () => {
  it('returns a value in [0,1]', () => {
    const s = salience({ at: hoursAgo(10), importance: 7 }, ctx);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('a fresh, max-importance, max-relevance item scores near 1', () => {
    const s = salience({ at: NOW.toISOString(), importance: 10, relevance: 1 }, ctx);
    expect(s).toBeGreaterThan(0.99);
  });

  it('importance 1 floors the score to 0 (normalized (1-1)/9 = 0)', () => {
    const s = salience({ at: NOW.toISOString(), importance: 1 }, ctx);
    expect(s).toBe(0);
  });

  it('decays by half over one half-life', () => {
    const fresh = salience({ at: NOW.toISOString(), importance: 10 }, ctx);
    const old = salience(
      { at: hoursAgo(DEFAULT_HALF_LIFE_HOURS), importance: 10 },
      ctx,
    );
    expect(old).toBeCloseTo(fresh * 0.5, 5);
  });

  it('treats a missing timestamp as fully recent', () => {
    const s = salience({ importance: 10 }, ctx);
    expect(s).toBeGreaterThan(0.99);
  });

  it('relevance scales the score linearly', () => {
    const full = salience({ at: NOW.toISOString(), importance: 10, relevance: 1 }, ctx);
    const half = salience({ at: NOW.toISOString(), importance: 10, relevance: 0.5 }, ctx);
    expect(half).toBeCloseTo(full * 0.5, 5);
  });

  it('clamps out-of-range importance', () => {
    const overMax = salience({ at: NOW.toISOString(), importance: 99 }, ctx);
    const atMax = salience({ at: NOW.toISOString(), importance: 10 }, ctx);
    expect(overMax).toBe(atMax);
  });

  it('treats future-dated events as fully recent (no negative decay)', () => {
    const future = new Date(NOW.getTime() + 1000 * 60 * 60).toISOString();
    const s = salience({ at: future, importance: 10 }, ctx);
    expect(s).toBeGreaterThan(0.99);
  });
});
