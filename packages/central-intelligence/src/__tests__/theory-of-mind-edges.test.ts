/**
 * Theory of mind — edge cases for inferMindState + renderMindStateDirective.
 *
 * Covers:
 *   - urgency=low ("when you have a moment")
 *   - urgency=medium default
 *   - mode=execute / mode=learn
 *   - expert tokens override novice phrasing
 *   - emotional charge negative for frustrated language
 *   - emotional charge positive for thanks
 *   - emotional charge clamped to [-1,1]
 *   - directive text adapts to each combination
 */

import { describe, it, expect } from 'vitest';
import {
  inferMindState,
  renderMindStateDirective,
} from '../kernel/index.js';

describe('inferMindState — urgency', () => {
  it('detects low urgency phrases', () => {
    expect(inferMindState('when you have a moment, can you check?').urgency).toBe('low');
    expect(inferMindState('no rush at all').urgency).toBe('low');
  });

  it('defaults to medium urgency', () => {
    expect(inferMindState('what is the lease balance').urgency).toBe('medium');
  });

  it('detects high urgency from "asap"', () => {
    expect(inferMindState('please do this asap').urgency).toBe('high');
  });

  it('detects high urgency from double exclamation marks', () => {
    expect(inferMindState('Fix this!!').urgency).toBe('high');
  });
});

describe('inferMindState — mode', () => {
  it('detects execute mode from imperative verbs', () => {
    expect(inferMindState('go ahead and proceed').mode).toBe('execute');
    expect(inferMindState('send the notice now').mode).toBe('execute');
  });

  it('detects learn mode from "teach me"', () => {
    expect(inferMindState('teach me how the arrears ladder works').mode).toBe('learn');
  });

  it('detects decide mode from "should I"', () => {
    expect(inferMindState('should I evict this tenant').mode).toBe('decide');
  });

  it('detects browse as the default', () => {
    expect(inferMindState('what is the rent').mode).toBe('browse');
  });

  it('execute beats decide when both signals present', () => {
    // Execute is checked first, so "do it" wins over "should I".
    expect(inferMindState('do it; should I send notice?').mode).toBe('execute');
  });
});

describe('inferMindState — expertise', () => {
  it('expert vocabulary wins over novice framing', () => {
    expect(inferMindState('what is the cap rate again').expertise).toBe('expert');
    expect(inferMindState('how do i compute DSCR').expertise).toBe('expert');
  });

  it('detects pure novice framing', () => {
    expect(inferMindState('how do i pay rent').expertise).toBe('novice');
  });

  it('returns intermediate by default', () => {
    expect(inferMindState('who handles this').expertise).toBe('intermediate');
  });
});

describe('inferMindState — emotional charge', () => {
  it('produces negative score for frustrated language', () => {
    expect(inferMindState('I am furious about this').emotionalCharge).toBeLessThan(0);
  });

  it('produces positive score for thanks', () => {
    expect(inferMindState('thanks, that was helpful').emotionalCharge).toBeGreaterThan(0);
  });

  it('emotional charge stays in [-1, 1]', () => {
    const state = inferMindState('I am furious!!!');
    expect(state.emotionalCharge).toBeGreaterThanOrEqual(-1);
    expect(state.emotionalCharge).toBeLessThanOrEqual(1);
  });

  it('neutral message has zero emotional charge', () => {
    expect(inferMindState('what is the rent').emotionalCharge).toBe(0);
  });
});

describe('renderMindStateDirective', () => {
  it('high urgency directive leads with action', () => {
    const directive = renderMindStateDirective(inferMindState('do this now!!!'));
    expect(directive).toMatch(/Lead with the action/);
  });

  it('low urgency directive uses measured tone', () => {
    const directive = renderMindStateDirective(inferMindState('whenever you have a moment'));
    expect(directive).toMatch(/measured tone/);
  });

  it('novice directive defines jargon', () => {
    const directive = renderMindStateDirective(inferMindState('how do i pay rent'));
    expect(directive).toMatch(/Define any jargon/);
  });

  it('expert directive permits domain shorthand', () => {
    const directive = renderMindStateDirective(inferMindState('cap rate by block'));
    expect(directive).toMatch(/domain shorthand/);
  });

  it('decide-mode directive ends with one recommendation', () => {
    // Avoid "send" / "do it" tokens that would force execute mode.
    const directive = renderMindStateDirective(inferMindState('should I escalate?'));
    expect(directive).toMatch(/single recommendation/);
  });

  it('execute-mode directive confirms then acts', () => {
    const directive = renderMindStateDirective(inferMindState('go ahead and send it'));
    expect(directive).toMatch(/Confirm what will be done/);
  });

  it('learn-mode directive teaches by example', () => {
    const directive = renderMindStateDirective(inferMindState('teach me'));
    expect(directive).toMatch(/Teach by example/);
  });

  it('frustrated user directive acknowledges', () => {
    const directive = renderMindStateDirective(inferMindState('I am so frustrated with this'));
    expect(directive).toMatch(/frustrated/);
  });

  it('returns the default conversational pace when nothing applies', () => {
    const state = {
      urgency: 'medium' as const,
      expertise: 'intermediate' as const,
      mode: 'browse' as const,
      emotionalCharge: 0,
    };
    expect(renderMindStateDirective(state)).toBe('Answer at conversational pace.');
  });
});
