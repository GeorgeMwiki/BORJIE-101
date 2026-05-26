import { describe, expect, it } from 'vitest';

import {
  naiveSwahiliPort,
  passthroughLlmGrader,
  scoreGrammar,
} from '../score/grammar-scorer.js';

describe('grammar-scorer', () => {
  it('flags Swahili noun-class violation: `ki mtu`', async () => {
    const result = await scoreGrammar('ki mtu yule amekuja', 'sw', {
      swahili: naiveSwahiliPort,
      fallback: passthroughLlmGrader,
    });
    expect(result.score).toBeLessThan(1);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.kind).toBe('noun-class-violation');
  });

  it('flags missing noun-class agreement: `mtu kubwa`', async () => {
    const result = await scoreGrammar('mtu kubwa amekuja', 'sw', {
      swahili: naiveSwahiliPort,
      fallback: passthroughLlmGrader,
    });
    expect(result.issues.some((i) => i.kind === 'agreement-error')).toBe(true);
  });

  it('passes clean Swahili text with no violations', async () => {
    const result = await scoreGrammar(
      'parseli ya gramu mia tisa themanini',
      'sw',
      {
        swahili: naiveSwahiliPort,
        fallback: passthroughLlmGrader,
      },
    );
    expect(result.score).toBe(1);
    expect(result.issues).toHaveLength(0);
  });

  it('routes English text through the fallback LLM grader', async () => {
    const result = await scoreGrammar('hello world', 'en', {
      swahili: naiveSwahiliPort,
      fallback: passthroughLlmGrader,
    });
    expect(result.score).toBe(1);
  });
});
