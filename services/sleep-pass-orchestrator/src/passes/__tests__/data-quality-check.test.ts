import { describe, expect, it } from 'vitest';
import {
  createDataQualityCheckPass,
  createInMemoryDataQualityAdapter,
} from '../index.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

describe('data-quality-check pass', () => {
  it('flags only rows with anomalies', async () => {
    const adapter = createInMemoryDataQualityAdapter([
      { table: 't', recordId: '1', recordedAt: '', anomaly: 'null-required-field' },
      { table: 't', recordId: '2', recordedAt: '', anomaly: null },
    ]);
    const pass = createDataQualityCheckPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(2);
    expect(result.itemsEmitted).toBe(1);
    expect(adapter.flagged()).toHaveLength(1);
  });

  it('returns zero flagged when all rows clean', async () => {
    const adapter = createInMemoryDataQualityAdapter([
      { table: 't', recordId: '1', recordedAt: '', anomaly: null },
      { table: 't', recordId: '2', recordedAt: '', anomaly: null },
    ]);
    const pass = createDataQualityCheckPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(0);
  });
});
