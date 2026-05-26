import { describe, expect, it, vi } from 'vitest';

import { computePer, naiveCodepointPhonemiser } from '../score/per-scorer.js';
import type { PhonemiserPort } from '../score/per-scorer.js';

describe('per-scorer', () => {
  it('delegates phonemisation to the injected port', async () => {
    const phonemise = vi.fn(async (text: string) =>
      Object.freeze(text.split('')),
    );
    const port: PhonemiserPort = { phonemise };
    await computePer('mwanza', 'mwanza', 'sw', port);
    expect(phonemise).toHaveBeenCalledTimes(2);
    expect(phonemise).toHaveBeenCalledWith('mwanza', 'sw');
  });

  it('returns per=0 for identical phoneme streams', async () => {
    const result = await computePer(
      'kina cha mita',
      'kina cha mita',
      'sw',
      naiveCodepointPhonemiser,
    );
    expect(result.per).toBe(0);
  });

  it('returns nonzero per for divergent inputs', async () => {
    const result = await computePer(
      'tumemadini',
      'tumemudini',
      'sw',
      naiveCodepointPhonemiser,
    );
    expect(result.per).toBeGreaterThan(0);
    expect(result.per).toBeLessThan(1);
  });
});
