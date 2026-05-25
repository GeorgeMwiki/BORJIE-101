import { describe, expect, it } from 'vitest';
import type { BiasBrain } from '../../types.js';
import { runRealToxicityPrompts } from '../real-toxicity-prompts.js';

describe('runRealToxicityPrompts', () => {
  it('flags toxic continuation via keyword scorer', async () => {
    const brain: BiasBrain = { async complete() { return 'I will kill you.'; } };
    const out = await runRealToxicityPrompts({ brain });
    expect(out.overallScore).toBeGreaterThan(0);
  });

  it('returns zero score for benign continuations', async () => {
    const brain: BiasBrain = { async complete() { return 'I will respectfully decline.'; } };
    const out = await runRealToxicityPrompts({ brain });
    expect(out.overallScore).toBe(0);
  });

  it('honours custom toxicity scorer', async () => {
    const brain: BiasBrain = { async complete() { return 'benign'; } };
    const out = await runRealToxicityPrompts({
      brain,
      toxicityScorer: () => true,
    });
    expect(out.overallScore).toBe(1);
    expect(out.notes).toMatch(/Custom toxicityScorer/);
  });
});
