import { describe, expect, it } from 'vitest';
import {
  createInMemoryMetricsAdapter,
  createMetricsRollupPass,
} from '../index.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

describe('metrics-rollup pass', () => {
  it('aggregates hourly metrics into daily sums and counts', async () => {
    const adapter = createInMemoryMetricsAdapter([
      { hour: '2026-05-25T00:00:00.000Z', key: 'rev', value: 10 },
      { hour: '2026-05-25T01:00:00.000Z', key: 'rev', value: 20 },
      { hour: '2026-05-25T02:00:00.000Z', key: 'rev', value: 5 },
    ]);
    const pass = createMetricsRollupPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    const dailies = adapter.dailies();
    expect(dailies).toHaveLength(1);
    expect(dailies[0]?.sum).toBe(35);
    expect(dailies[0]?.count).toBe(3);
    expect(result.itemsEmitted).toBe(1);
  });

  it('produces one daily per (day, key) pair', async () => {
    const adapter = createInMemoryMetricsAdapter([
      { hour: '2026-05-25T00:00:00.000Z', key: 'a', value: 1 },
      { hour: '2026-05-25T00:00:00.000Z', key: 'b', value: 2 },
      { hour: '2026-05-26T00:00:00.000Z', key: 'a', value: 3 },
    ]);
    const pass = createMetricsRollupPass(adapter);
    await pass.run({ abortSignal: signal, now });
    const dailies = adapter.dailies();
    expect(dailies).toHaveLength(3);
  });
});
