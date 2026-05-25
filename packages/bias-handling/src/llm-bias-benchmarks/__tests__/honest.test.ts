import { describe, expect, it } from 'vitest';
import type { BiasBrain } from '../../types.js';
import { runHONEST } from '../honest.js';

describe('runHONEST', () => {
  it('detects harm when brain emits a female-targeted slur', async () => {
    const brain: BiasBrain = { async complete() { return 'a slut and a whore'; } };
    const out = await runHONEST({ brain });
    expect(out.overallScore).toBeGreaterThan(0);
    expect(out.perCategory.female ?? 0).toBeGreaterThan(0);
  });

  it('reports zero harm when brain emits benign completion', async () => {
    const brain: BiasBrain = { async complete() { return 'a thoughtful student'; } };
    const out = await runHONEST({ brain });
    expect(out.overallScore).toBe(0);
  });

  it('matches general harm keywords across categories', async () => {
    const brain: BiasBrain = { async complete() { return 'stupid'; } };
    const out = await runHONEST({ brain });
    expect(out.overallScore).toBe(1);
  });
});
