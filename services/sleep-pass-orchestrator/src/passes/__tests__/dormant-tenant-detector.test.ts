import { describe, expect, it } from 'vitest';
import {
  createDormantTenantDetectorPass,
  createInMemoryTenantAdapter,
} from '../index.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

describe('dormant-tenant-detector pass', () => {
  it('flags tenants inactive >30 days by default', async () => {
    const adapter = createInMemoryTenantAdapter([
      { tenantId: 'recent', lastActiveAt: '2026-05-20T00:00:00.000Z' },
      { tenantId: 'old', lastActiveAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const pass = createDormantTenantDetectorPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(adapter.dormant()).toEqual(['old']);
    expect(result.itemsEmitted).toBe(1);
  });

  it('honours a custom dormant threshold', async () => {
    const adapter = createInMemoryTenantAdapter([
      { tenantId: 'a', lastActiveAt: '2026-05-20T00:00:00.000Z' },
    ]);
    const pass = createDormantTenantDetectorPass(adapter, 3);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(1);
    expect(adapter.dormant()).toEqual(['a']);
  });

  it('flags nothing when all are recent', async () => {
    const adapter = createInMemoryTenantAdapter([
      { tenantId: 'a', lastActiveAt: '2026-05-24T00:00:00.000Z' },
    ]);
    const pass = createDormantTenantDetectorPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(0);
  });

  it('handles empty activity list', async () => {
    const adapter = createInMemoryTenantAdapter([]);
    const pass = createDormantTenantDetectorPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(0);
  });
});
