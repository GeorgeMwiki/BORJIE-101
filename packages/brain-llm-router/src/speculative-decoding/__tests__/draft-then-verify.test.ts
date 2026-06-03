import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  speculativeDecode,
  isSpeculativeDecodingEnabled,
  type SpeculativeModelClient,
} from '../index.js';

afterEach(() => {
  delete process.env.BORJIE_SPECULATIVE_DECODING;
});

const client = (id: string, out: string): SpeculativeModelClient => ({
  modelId: id,
  generate: vi.fn(async () => out),
});

describe('speculativeDecode (scaffold)', () => {
  it('returns the verifier output as the authoritative answer', async () => {
    const r = await speculativeDecode({
      prompt: 'royalty rate?',
      modelDraft: client('haiku', 'The royalty rate is'),
      modelMain: client('opus', 'The royalty rate is 6 percent.'),
    });
    expect(r.text).toBe('The royalty rate is 6 percent.');
    expect(r.stats.mainModelId).toBe('opus');
    expect(r.stats.fellBackToMainOnly).toBe(false);
  });

  it('reports an acceptance rate from the draft/verifier common prefix', async () => {
    const r = await speculativeDecode({
      prompt: 'p',
      modelDraft: client('haiku', 'ABCDEFGH'),
      modelMain: client('opus', 'ABCDxyz'),
    });
    // 4-char common prefix out of an 8-char draft → 0.5.
    expect(r.stats.acceptedCharsApprox).toBe(4);
    expect(r.stats.draftedCharsApprox).toBe(8);
    expect(r.stats.acceptRate).toBeCloseTo(0.5);
  });

  it('falls back to verifier-only when the draft model throws', async () => {
    const draft: SpeculativeModelClient = {
      modelId: 'haiku',
      generate: async () => {
        throw new Error('draft down');
      },
    };
    const r = await speculativeDecode({
      prompt: 'p',
      modelDraft: draft,
      modelMain: client('opus', 'final answer'),
    });
    expect(r.text).toBe('final answer');
    expect(r.stats.fellBackToMainOnly).toBe(true);
    expect(r.stats.acceptRate).toBe(0);
  });

  it('is opt-in via the env flag', () => {
    expect(isSpeculativeDecodingEnabled()).toBe(false);
    process.env.BORJIE_SPECULATIVE_DECODING = '1';
    expect(isSpeculativeDecodingEnabled()).toBe(true);
  });
});
