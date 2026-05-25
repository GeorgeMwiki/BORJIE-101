/**
 * Cognitive load — edge cases and renderLoadDirective coverage.
 *
 * Covers:
 *   - empty message → low
 *   - long message alone is medium (1 score)
 *   - hesitation markers add score
 *   - high recent turn volume contributes
 *   - high load yields verdict='soften' with cognitive-overload reason
 *   - load thresholds (low/medium/high) at score boundaries
 *   - renderLoadDirective text shape per band
 *   - allowArtifact false at high load
 */

import { describe, it, expect } from 'vitest';
import {
  assessCognitiveLoad,
  renderLoadDirective,
} from '../kernel/index.js';

describe('assessCognitiveLoad', () => {
  it('returns low for an empty message and no recent turns', () => {
    const out = assessCognitiveLoad({ userMessage: '', recentTurnCount: 0 });
    expect(out.load).toBe('low');
    expect(out.verdict.status).toBe('pass');
    expect(out.allowArtifact).toBe(true);
    expect(out.maxSentences).toBe(12);
    expect(out.maxCitations).toBe(8);
  });

  it('classifies a long single message as medium', () => {
    const longMessage = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const out = assessCognitiveLoad({ userMessage: longMessage, recentTurnCount: 0 });
    expect(out.load).toBe('medium');
    expect(out.maxSentences).toBe(6);
    expect(out.maxCitations).toBe(5);
  });

  it('classifies a multi-question short rapid-fire turn as medium', () => {
    const out = assessCognitiveLoad({
      userMessage: 'rent? lease? balance?',
      recentTurnCount: 0,
    });
    expect(out.load).toBe('medium');
  });

  it('detects hesitation markers when at least two are present', () => {
    // The scorer requires hesitationHits >= 2 to add to score.
    const out = assessCognitiveLoad({
      userMessage: 'um, actually... wait, hmm',
      recentTurnCount: 0,
    });
    expect(out.load).toBe('medium');
  });

  it('does NOT escalate from a single hesitation marker alone', () => {
    const out = assessCognitiveLoad({
      userMessage: 'um, what is the rent?',
      recentTurnCount: 0,
    });
    expect(out.load).toBe('low');
  });

  it('high recent turn volume contributes to score', () => {
    const out = assessCognitiveLoad({ userMessage: 'help', recentTurnCount: 6 });
    expect(out.load).toBe('medium');
  });

  it('combines multiple signals to reach high load', () => {
    const longMessage = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
    const out = assessCognitiveLoad({
      userMessage: `${longMessage} um... why? how? what?`,
      recentTurnCount: 8,
    });
    expect(out.load).toBe('high');
    expect(out.verdict.status).toBe('soften');
    if (out.verdict.status === 'soften') {
      expect(out.verdict.reason).toMatch(/cognitive overload/);
    }
    expect(out.allowArtifact).toBe(false);
    expect(out.maxSentences).toBe(3);
    expect(out.maxCitations).toBe(2);
  });
});

describe('renderLoadDirective', () => {
  it('renders the maxSentences and maxCitations as a directive', () => {
    const out = assessCognitiveLoad({ userMessage: 'short', recentTurnCount: 0 });
    const directive = renderLoadDirective(out);
    expect(directive).toMatch(/at most 12 sentences/);
    expect(directive).toMatch(/at most 8 inline citations/);
  });

  it('appends a "no artifact" note for high load', () => {
    const longMessage = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
    const out = assessCognitiveLoad({
      userMessage: `${longMessage} um... why? how? what?`,
      recentTurnCount: 8,
    });
    const directive = renderLoadDirective(out);
    expect(directive).toMatch(/Do not produce an artifact/);
  });

  it('omits the artifact note for low/medium load', () => {
    const out = assessCognitiveLoad({ userMessage: 'short', recentTurnCount: 0 });
    const directive = renderLoadDirective(out);
    expect(directive).not.toMatch(/Do not produce an artifact/);
  });

  it('a directive at medium load uses 6/5 limits', () => {
    const longMessage = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const out = assessCognitiveLoad({ userMessage: longMessage, recentTurnCount: 0 });
    const directive = renderLoadDirective(out);
    expect(directive).toMatch(/at most 6 sentences/);
    expect(directive).toMatch(/at most 5 inline citations/);
  });
});
