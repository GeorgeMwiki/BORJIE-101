import { describe, expect, it } from 'vitest';
import { createReuseCounter } from '../lifecycle/reuse-counter.js';

describe('reuse-counter', () => {
  it('counts a single record correctly', () => {
    const c = createReuseCounter();
    c.record('h1', 'user-a');
    expect(c.count('h1')).toBe(1);
    expect(c.distinctUserCount('h1')).toBe(1);
  });

  it('increments total + distinct users separately', () => {
    const c = createReuseCounter();
    c.record('h1', 'a');
    c.record('h1', 'a'); // same user — total goes up, distinct stays
    c.record('h1', 'b'); // new user
    expect(c.count('h1')).toBe(3);
    expect(c.distinctUserCount('h1')).toBe(2);
  });

  it('keeps separate hashes independent', () => {
    const c = createReuseCounter();
    c.record('h1', 'a');
    c.record('h2', 'a');
    expect(c.count('h1')).toBe(1);
    expect(c.count('h2')).toBe(1);
    expect(c.count('h-unknown')).toBe(0);
    expect(c.distinctUserCount('h-unknown')).toBe(0);
  });

  it('snapshot returns null for unknown', () => {
    const c = createReuseCounter();
    expect(c.snapshot('nope')).toBeNull();
  });

  it('snapshot returns a frozen-shaped object', () => {
    const c = createReuseCounter();
    c.record('h', 'u');
    const snap = c.snapshot('h');
    expect(snap?.count).toBe(1);
    expect(snap?.distinct_user_count).toBe(1);
    expect(snap?.recipe_hash).toBe('h');
  });

  it('clear empties the counter', () => {
    const c = createReuseCounter();
    c.record('h', 'u');
    c.clear();
    expect(c.count('h')).toBe(0);
  });
});
