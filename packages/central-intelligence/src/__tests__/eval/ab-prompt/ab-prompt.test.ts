/**
 * A/B prompt comparison runner tests — Phase D / D12.5.
 */

import { describe, it, expect } from 'vitest';
import {
  runAbPrompt,
  type AbPromptVariant,
  type AbScenario,
} from './runner.js';

const CORPUS: ReadonlyArray<AbScenario> = [
  { id: 'ab.1', description: 'rent reminder' },
  { id: 'ab.2', description: 'lease renewal' },
  { id: 'ab.3', description: 'eviction packet' },
  { id: 'ab.4', description: 'KRA MRI filing' },
];

const PROMPT_A: AbPromptVariant = {
  id: 'baseline-v1',
  label: 'baseline',
  simulate: () => ({
    score: 0.78,
    costUsd: 0.005,
    latencyMs: 620,
    completed: true,
  }),
};

const PROMPT_B: AbPromptVariant = {
  id: 'rewrite-2026-05-17',
  label: 'rewrite',
  simulate: () => ({
    score: 0.86,
    costUsd: 0.008,
    latencyMs: 540,
    completed: true,
  }),
};

const PROMPT_BAD: AbPromptVariant = {
  id: 'broken-prompt',
  label: 'broken',
  simulate: (id) => ({
    score: 0.3,
    costUsd: 0.005,
    latencyMs: 620,
    completed: id === 'ab.1',
  }),
};

describe('A/B prompt runner', () => {
  it('produces a per-axis verdict for each comparison axis', () => {
    const outcome = runAbPrompt(PROMPT_A, PROMPT_B, CORPUS);
    expect(outcome.verdicts.map((v) => v.axis).sort()).toEqual(
      ['completion-rate', 'cost', 'latency', 'score'],
    );
  });

  it('declares B the winner on score AND latency when B is better', () => {
    const outcome = runAbPrompt(PROMPT_A, PROMPT_B, CORPUS);
    const scoreV = outcome.verdicts.find((v) => v.axis === 'score');
    const latencyV = outcome.verdicts.find((v) => v.axis === 'latency');
    expect(scoreV?.winner).toBe('B');
    expect(latencyV?.winner).toBe('B');
  });

  it('declares A the winner on cost when A is cheaper', () => {
    const outcome = runAbPrompt(PROMPT_A, PROMPT_B, CORPUS);
    const costV = outcome.verdicts.find((v) => v.axis === 'cost');
    expect(costV?.winner).toBe('A');
  });

  it('returns a tie when both variants are identical', () => {
    const outcome = runAbPrompt(PROMPT_A, PROMPT_A, CORPUS);
    for (const v of outcome.verdicts) {
      expect(v.winner).toBe('tie');
    }
  });

  it('records completion-rate < 1 when scenarios fail to complete', () => {
    const outcome = runAbPrompt(PROMPT_A, PROMPT_BAD, CORPUS);
    expect(outcome.a.completionRate).toBe(1);
    expect(outcome.b.completionRate).toBeLessThan(1);
    const cr = outcome.verdicts.find((v) => v.axis === 'completion-rate');
    expect(cr?.winner).toBe('A');
  });

  it('headline summary references both variant labels', () => {
    const outcome = runAbPrompt(PROMPT_A, PROMPT_B, CORPUS);
    expect(outcome.headline.length).toBeGreaterThan(0);
    expect(outcome.headline).toMatch(/baseline|rewrite/);
  });
});
