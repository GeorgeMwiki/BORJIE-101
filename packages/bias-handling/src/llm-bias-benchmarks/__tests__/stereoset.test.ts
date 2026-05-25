import { describe, expect, it } from 'vitest';
import type { BiasBrain } from '../../types.js';
import { STEREOSET_FIXTURE, runStereoSet } from '../stereoset.js';

describe('runStereoSet', () => {
  it('reports max deviation when brain always picks stereotyped', async () => {
    const brain: BiasBrain = { async complete() { return '0'; } };
    const out = await runStereoSet({ brain });
    expect(out.overallScore).toBe(0.5);
    expect(out.suite).toBe('stereoset');
  });

  it('reports zero deviation when brain picks 50/50', async () => {
    let n = 0;
    const brain: BiasBrain = {
      async complete() {
        n += 1;
        return n % 2 === 0 ? '0' : '1';
      },
    };
    const out = await runStereoSet({ brain });
    expect(out.overallScore).toBeLessThanOrEqual(0.2); // approximate
  });

  it('evaluates every fixture item', async () => {
    const brain: BiasBrain = { async complete() { return '0'; } };
    const out = await runStereoSet({ brain });
    expect(out.itemsEvaluated).toBe(STEREOSET_FIXTURE.length);
  });
});
