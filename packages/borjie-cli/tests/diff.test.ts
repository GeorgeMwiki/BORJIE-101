import { describe, expect, it } from 'vitest';
import { resolveTimestamp } from '../src/commands/diff.js';

describe('diff timestamp resolver', () => {
  it('parses ISO-8601', () => {
    const out = resolveTimestamp('2026-05-29T00:00:00Z');
    expect(out).toBe('2026-05-29T00:00:00.000Z');
  });

  it('parses relative spans', () => {
    const out = resolveTimestamp('24h');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws on bogus input', () => {
    expect(() => resolveTimestamp('zoinks')).toThrow();
  });
});
