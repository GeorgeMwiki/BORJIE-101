/**
 * Tests for the bank-EFT placeholder adapter.
 *
 * Phase D update: the adapter now FAILS LOUD instead of returning a
 * benign `'failed'` row. Valid inputs throw `EftNotConfiguredError`;
 * invalid inputs still return `'failed'` so callers can distinguish
 * "input was malformed" from "no bank rail bound".
 *
 * W1.5 / DA3 update: the adapter accepts an optional `regionResolver`
 * closure that resolves `tenants.region`. The resolved region is
 * surfaced in the refusal error so operators can see at a glance
 * which per-jurisdiction MCP server SHOULD have been routed to.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createEftStubAdapter,
  EftNotConfiguredError,
  resolveEftRegion,
} from '../eft-stub-adapter';
import type { PayoutProviderInput } from '../../stub-payout-provider';

const INPUT: PayoutProviderInput = {
  tenantId: 'tenant-eft',
  ownerId: 'owner-eft',
  amountMinor: 12_000,
  currency: 'TZS',
  destination: 'NMB:0150123456789',
  idempotencyKey: 'eft-1',
};

describe('createEftStubAdapter', () => {
  it('throws EftNotConfiguredError for a valid input (loud-failure)', async () => {
    const adapter = createEftStubAdapter();
    await expect(adapter.send(INPUT)).rejects.toBeInstanceOf(EftNotConfiguredError);
  });

  it('rejects negative amounts BEFORE the loud refusal', async () => {
    const adapter = createEftStubAdapter();
    const result = await adapter.send({ ...INPUT, amountMinor: -1 });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('eft_invalid_amount');
  });

  it('rejects empty destination BEFORE the loud refusal', async () => {
    const adapter = createEftStubAdapter();
    const result = await adapter.send({ ...INPUT, destination: '   ' });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('eft_missing_destination');
  });

  it('surfaces tenantId in the error message so DLQ rows are traceable', async () => {
    const adapter = createEftStubAdapter();
    let caught: unknown = null;
    try {
      await adapter.send({ ...INPUT, tenantId: 'tenant-XYZ' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EftNotConfiguredError);
    expect((caught as Error).message).toContain('tenant-XYZ');
  });
});

// W1.5 / DA3 — region-resolver wiring (`getTenantRegion(db, tenantId)`
// composed in stub-payout-provider). The adapter must thread the
// tenant's home region into the refusal error so operators can spot
// which per-jurisdiction MCP server SHOULD have been bound.
describe('createEftStubAdapter — region resolution via tenants.region', () => {
  it("uses tenant.region='af-south-1' verbatim when the resolver returns it", async () => {
    const regionResolver = vi.fn(async (tenantId: string) => {
      expect(tenantId).toBe('tenant-ZA');
      return 'af-south-1';
    });
    const adapter = createEftStubAdapter({ regionResolver, defaultRegion: 'eu-west-1' });
    let caught: unknown = null;
    try {
      await adapter.send({ ...INPUT, tenantId: 'tenant-ZA' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EftNotConfiguredError);
    expect((caught as Error).message).toContain('region=af-south-1');
    expect(regionResolver).toHaveBeenCalledTimes(1);
  });

  it('falls back to env.AWS_REGION (via defaultRegion) when the resolver returns null', async () => {
    const regionResolver = vi.fn(async () => null);
    const adapter = createEftStubAdapter({
      regionResolver,
      defaultRegion: 'eu-west-1',
    });
    let caught: unknown = null;
    try {
      await adapter.send({ ...INPUT, tenantId: 'tenant-unprovisioned' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EftNotConfiguredError);
    expect((caught as Error).message).toContain('region=eu-west-1');
    expect(regionResolver).toHaveBeenCalledTimes(1);
  });

  it('falls back to env.AWS_REGION when the resolver throws (transient DB outage)', async () => {
    const regionResolver = vi.fn(async () => {
      throw new Error('db_unavailable');
    });
    const adapter = createEftStubAdapter({
      regionResolver,
      defaultRegion: 'eu-west-1',
    });
    let caught: unknown = null;
    try {
      await adapter.send({ ...INPUT, tenantId: 'tenant-ZA' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EftNotConfiguredError);
    expect((caught as Error).message).toContain('region=eu-west-1');
  });

  it("tags 'unknown-region' when neither resolver nor defaultRegion yields a value", async () => {
    // Simulate the no-config edge: resolver missing AND env.AWS_REGION
    // not set. We patch process.env transiently so the adapter cannot
    // pick up an ambient default from the test runner's environment.
    const previous = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    try {
      const adapter = createEftStubAdapter();
      let caught: unknown = null;
      try {
        await adapter.send({ ...INPUT, tenantId: 'tenant-no-resolver' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EftNotConfiguredError);
      expect((caught as Error).message).toContain('region=unknown-region');
    } finally {
      if (previous !== undefined) {
        process.env.AWS_REGION = previous;
      }
    }
  });
});

describe('resolveEftRegion — pure region-resolution helper', () => {
  it('returns the resolver value when non-empty', async () => {
    const out = await resolveEftRegion('tenant-ZA', {
      regionResolver: async () => 'af-south-1',
      defaultRegion: 'eu-west-1',
    });
    expect(out).toBe('af-south-1');
  });

  it('returns defaultRegion when the resolver returns null', async () => {
    const out = await resolveEftRegion('tenant-X', {
      regionResolver: async () => null,
      defaultRegion: 'eu-west-1',
    });
    expect(out).toBe('eu-west-1');
  });

  it('returns defaultRegion when no resolver is supplied', async () => {
    const out = await resolveEftRegion('tenant-X', { defaultRegion: 'eu-west-1' });
    expect(out).toBe('eu-west-1');
  });

  it('returns null when tenantId is empty AND no defaultRegion / env.AWS_REGION', async () => {
    const previous = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    try {
      const out = await resolveEftRegion('', {
        regionResolver: async () => 'af-south-1', // never invoked for empty id
      });
      expect(out).toBeNull();
    } finally {
      if (previous !== undefined) {
        process.env.AWS_REGION = previous;
      }
    }
  });
});
