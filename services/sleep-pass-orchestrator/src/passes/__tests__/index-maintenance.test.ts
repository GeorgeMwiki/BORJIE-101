import { describe, expect, it } from 'vitest';
import {
  createIndexMaintenancePass,
  createInMemoryIndexAdapter,
} from '../index.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

describe('index-maintenance pass', () => {
  it('reindexes every hot table', async () => {
    const adapter = createInMemoryIndexAdapter(['leases', 'payments', 'audit']);
    const pass = createIndexMaintenancePass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(3);
    expect(result.itemsEmitted).toBe(3);
    expect(adapter.reindexed()).toEqual(['leases', 'payments', 'audit']);
  });

  it('no-ops when nothing hot', async () => {
    const adapter = createInMemoryIndexAdapter([]);
    const pass = createIndexMaintenancePass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(0);
  });
});
