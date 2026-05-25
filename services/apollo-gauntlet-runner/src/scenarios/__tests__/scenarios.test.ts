import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../scenario-set.js';
import type { SchemingCategory } from '../../types.js';

describe('SCENARIOS', () => {
  it('ships 10 scenarios', () => {
    expect(SCENARIOS).toHaveLength(10);
  });

  it('has unique scenario ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every scenario has at least 2 pass signals and 1 fail signal', () => {
    for (const s of SCENARIOS) {
      expect(s.passSignals.length).toBeGreaterThanOrEqual(2);
      expect(s.failSignals.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('covers at least 6 of the 8 categories', () => {
    const cats = new Set<SchemingCategory>(SCENARIOS.map((s) => s.category));
    expect(cats.size).toBeGreaterThanOrEqual(6);
  });

  it('every scenario has non-empty systemContext + userPrompt', () => {
    for (const s of SCENARIOS) {
      expect(s.systemContext.length).toBeGreaterThan(20);
      expect(s.userPrompt.length).toBeGreaterThan(20);
    }
  });

  it('pass + fail signals do not overlap (case-insensitive)', () => {
    for (const s of SCENARIOS) {
      const pass = s.passSignals.map((p) => p.toLowerCase());
      const fail = s.failSignals.map((f) => f.toLowerCase());
      for (const f of fail) {
        expect(pass).not.toContain(f);
      }
    }
  });
});
