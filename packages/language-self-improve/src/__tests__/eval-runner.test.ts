import { describe, expect, it } from 'vitest';

import { runEvalGauntlet } from '../eval/eval-runner.js';
import type { LanguageModelPort } from '../eval/eval-runner.js';
import type { Adapter, GauntletEntry } from '../types.js';

function mkAdapter(id: string): Adapter {
  return Object.freeze({
    id,
    tenantId: 't1',
    lang: 'sw',
    version: 'v1',
    adapterKind: 'lora' as const,
    baseModel: 'base',
    trainingPairCount: 100,
    status: 'staged' as const,
    createdAt: '2026-05-26T00:00:00Z',
    auditHash: 'h',
  });
}

function mkEntry(id: string, expected: string): GauntletEntry {
  return Object.freeze({
    id,
    tenantId: 't1',
    lang: 'sw',
    prompt: `prompt-${id}`,
    expectedText: expected,
    expectedIntent: null,
    domain: null,
    dialect: 'bongo' as const,
    category: 'regulatory' as const,
    auditHash: 'h',
  });
}

describe('eval-runner', () => {
  it('computes per-axis deltas — proposed adapter improves over current', async () => {
    const proposed = mkAdapter('proposed');
    // The model port returns "correct" output for the proposed adapter,
    // and "wrong" output for the current (null) adapter.
    const port: LanguageModelPort = {
      async generate(prompt, adapter, _lang) {
        if (adapter && adapter.id === 'proposed') {
          // Strip the "prompt-" prefix to return what should look like
          // the expected ID-derived transcript — we'll match expected
          // exactly for the proposed adapter.
          return prompt.replace('prompt-', '');
        }
        return 'totally wrong output unrelated to expected';
      },
    };
    const entries = [
      mkEntry('a', 'a'),
      mkEntry('b', 'b'),
      mkEntry('c', 'c'),
    ];
    const result = await runEvalGauntlet(null, proposed, entries, {
      model: port,
    });
    // Proposed should have WER near 0 (perfect match), current near 1.
    expect(result.proposed.wer).toBeLessThan(0.5);
    expect(result.current.wer).toBeGreaterThan(0.5);
    // Delta should be negative (improvement).
    expect(result.delta.wer).toBeLessThan(0);
  });

  it('computes neutral delta when both adapters produce same output', async () => {
    const proposed = mkAdapter('proposed');
    const port: LanguageModelPort = {
      async generate(_prompt, _adapter, _lang) {
        return 'same output';
      },
    };
    const entries = [mkEntry('a', 'same output'), mkEntry('b', 'same output')];
    const result = await runEvalGauntlet(null, proposed, entries, {
      model: port,
    });
    expect(result.delta.wer).toBe(0);
  });
});
