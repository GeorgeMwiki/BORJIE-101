import { describe, expect, it } from 'vitest';
import { emitPrmTrainingSample } from './data-collection.js';
import type { PrmTrainingSample } from './types.js';

describe('emitPrmTrainingSample', () => {
  const fixedNow = (): Date => new Date('2026-05-19T12:00:00.000Z');

  it('emits a well-shaped sample to J1', async () => {
    const captured: PrmTrainingSample[] = [];
    const sample = await emitPrmTrainingSample(
      {
        conversationId: 'conv_1',
        taskClass: 'lease-renewal',
        steps: [
          { index: 0, description: 'fetch tenant profile' },
          { index: 1, description: 'compute renewal price', context: { rentTzs: 500000 } },
          { index: 2, description: 'draft renewal letter' },
        ],
        outcome: 'success',
        rewardSignal: 0.82,
        metadata: { jurisdiction: 'TZ-DSM' },
      },
      async (s) => {
        captured.push(s);
      },
      fixedNow,
    );

    expect(captured).toHaveLength(1);
    expect(sample.version).toBe('1.0');
    expect(sample.conversationId).toBe('conv_1');
    expect(sample.taskClass).toBe('lease-renewal');
    expect(sample.steps).toHaveLength(3);
    expect(sample.outcome).toBe('success');
    expect(sample.rewardSignal).toBe(0.82);
    expect(sample.emittedAt).toBe('2026-05-19T12:00:00.000Z');
    expect(sample.metadata?.jurisdiction).toBe('TZ-DSM');
  });

  it('rejects empty steps', async () => {
    await expect(
      emitPrmTrainingSample(
        {
          conversationId: 'c',
          taskClass: 't',
          steps: [],
          outcome: 'success',
          rewardSignal: 0.5,
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });

  it('rejects non-contiguous step indices', async () => {
    await expect(
      emitPrmTrainingSample(
        {
          conversationId: 'c',
          taskClass: 't',
          steps: [
            { index: 0, description: 'a' },
            { index: 2, description: 'b' }, // missing index 1
          ],
          outcome: 'success',
          rewardSignal: 0.5,
        },
        async () => {},
      ),
    ).rejects.toThrow(/contiguous/);
  });

  it('rejects negative rewardSignal (sums must be nonnegative)', async () => {
    await expect(
      emitPrmTrainingSample(
        {
          conversationId: 'c',
          taskClass: 't',
          steps: [{ index: 0, description: 'a' }],
          outcome: 'failure',
          rewardSignal: -0.1,
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });

  it('accepts cumulative rewards above 1 (trajectory sums)', async () => {
    const captured: unknown[] = [];
    await emitPrmTrainingSample(
      {
        conversationId: 'c',
        taskClass: 't',
        steps: [{ index: 0, description: 'a' }],
        outcome: 'success',
        rewardSignal: 4.7,
      },
      async (s) => {
        captured.push(s);
      },
    );
    expect(captured).toHaveLength(1);
  });

  it('rejects invalid outcome label', async () => {
    await expect(
      emitPrmTrainingSample(
        {
          conversationId: 'c',
          taskClass: 't',
          steps: [{ index: 0, description: 'a' }],
          // @ts-expect-error — testing runtime validation
          outcome: 'mostly-ok',
          rewardSignal: 0.5,
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });
});
