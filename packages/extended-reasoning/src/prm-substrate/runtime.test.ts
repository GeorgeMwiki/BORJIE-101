import { describe, expect, it, vi } from 'vitest';
import { scoreStepWithPRM } from './runtime.js';
import type { PrmModel, PrmStep } from './types.js';

const step: PrmStep = { index: 0, description: 'verify identity via Smile ID' };

describe('scoreStepWithPRM — drop-in contract', () => {
  it('returns unscored when no model is loaded', async () => {
    const result = await scoreStepWithPRM({
      step,
      loader: async () => null,
    });
    expect(result).toEqual({ kind: 'unscored', reason: 'no-model-loaded' });
  });

  it('returns scored when a model is loaded', async () => {
    const model: PrmModel = {
      modelId: 'prm-v0.1-test',
      score: async () => 0.73,
    };
    const result = await scoreStepWithPRM({
      step,
      loader: async () => model,
    });
    expect(result).toEqual({ kind: 'scored', value: 0.73, modelId: 'prm-v0.1-test' });
  });

  it('clamps out-of-range model scores into [0, 1]', async () => {
    const model: PrmModel = {
      modelId: 'prm-broken',
      score: async () => 1.42,
    };
    const result = await scoreStepWithPRM({ step, loader: async () => model });
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') expect(result.value).toBe(1);
  });

  it('fires onLowScore callback below warnBelow threshold', async () => {
    const model: PrmModel = {
      modelId: 'prm-v0.1-test',
      score: async () => 0.2,
    };
    const onLowScore = vi.fn();
    await scoreStepWithPRM({
      step,
      loader: async () => model,
      warnBelow: 0.4,
      onLowScore,
    });
    expect(onLowScore).toHaveBeenCalledTimes(1);
    expect(onLowScore.mock.calls[0]?.[0]).toBe(0.2);
  });

  it('does not fire callback at-or-above threshold', async () => {
    const model: PrmModel = {
      modelId: 'prm-v0.1-test',
      score: async () => 0.4,
    };
    const onLowScore = vi.fn();
    await scoreStepWithPRM({
      step,
      loader: async () => model,
      warnBelow: 0.4,
      onLowScore,
    });
    expect(onLowScore).not.toHaveBeenCalled();
  });

  it('degrades gracefully — no callback fires when no model loaded', async () => {
    const onLowScore = vi.fn();
    await scoreStepWithPRM({
      step,
      loader: async () => null,
      warnBelow: 0.9, // would fire if model were loaded with low score
      onLowScore,
    });
    expect(onLowScore).not.toHaveBeenCalled();
  });
});
