/**
 * Unit tests — createPlatformFeatureFlagsService.
 *
 * Coverage:
 *   - read() returns globalValue + tenantOverrides parsed from JSONB
 *   - read() handles missing flag (empty default)
 *   - read() returns empty default on DB error
 *   - setFlag() inserts a new row when none exists, captures previousValue=null
 *   - setFlag() updates existing row, captures previousValue
 *   - setFlag() rethrows on DB error
 *   - restoreFlag() deletes the row when previousValue=null
 *   - restoreFlag() updates the row when previousValue is supplied
 *   - restoreFlag() rethrows on DB error
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPlatformFeatureFlagsService } from '../../platform/feature-flags.service.js';
import { makeStubDb } from './_stub-db.js';

const deps = { resolveActor: () => 'operator-1' };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('platform.featureFlags — read', () => {
  it('returns parsed global + tenant override rows', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        scope: 'global',
        flagValue: true,
        lastSetAt: new Date('2026-05-01T00:00:00Z'),
      },
      {
        scope: 'tenant:acme',
        flagValue: 'variant-b',
        lastSetAt: new Date('2026-05-02T00:00:00Z'),
      },
    ]);
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    const out = await svc.read('my-flag');
    expect(out.flagName).toBe('my-flag');
    expect(out.globalValue).toBe(true);
    expect(out.tenantOverrides).toHaveLength(1);
    expect(out.tenantOverrides[0]?.tenantId).toBe('acme');
    expect(out.tenantOverrides[0]?.value).toBe('variant-b');
  });

  it('returns empty default when no rows exist', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    const out = await svc.read('missing');
    expect(out.globalValue).toBeNull();
    expect(out.tenantOverrides).toEqual([]);
  });

  it('returns empty default on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    const out = await svc.read('x');
    expect(out.globalValue).toBeNull();
    expect(out.tenantOverrides).toEqual([]);
  });

  it('returns empty default for empty flagName', async () => {
    const stub = makeStubDb();
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    const out = await svc.read('');
    expect(out.globalValue).toBeNull();
  });
});

describe('platform.featureFlags — setFlag', () => {
  it('inserts a new row with previousValue=null when no existing', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]); // existing read returns empty
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    const out = await svc.setFlag({
      flagName: 'my-flag',
      value: true,
      scope: 'global',
    });
    expect(out.previousValue).toBeNull();
    expect(out.value).toBe(true);
    const insert = stub.ops.find((o) => o.op === 'insert');
    expect(insert?.values?.scope).toBe('global');
    expect(insert?.values?.flagValue).toBe(true);
    expect(insert?.values?.createdBy).toBe('operator-1');
    expect(insert?.values?.lastSetBy).toBe('operator-1');
  });

  it('updates existing row + captures previousValue', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([{ flagValue: 'old-variant' }]); // existing read
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    const out = await svc.setFlag({
      flagName: 'my-flag',
      value: 'new-variant',
      scope: 'tenant:acme',
    });
    expect(out.previousValue).toBe('old-variant');
    expect(out.value).toBe('new-variant');
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.flagValue).toBe('new-variant');
    expect(update?.set?.lastSetBy).toBe('operator-1');
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    await expect(
      svc.setFlag({ flagName: 'x', value: true, scope: 'global' }),
    ).rejects.toThrow(/boom/);
  });

  it('refuses empty flagName', async () => {
    const stub = makeStubDb();
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    await expect(
      svc.setFlag({ flagName: '', value: true, scope: 'global' }),
    ).rejects.toThrow(/required/);
  });
});

describe('platform.featureFlags — restoreFlag', () => {
  it('deletes the row when previousValue=null', async () => {
    const stub = makeStubDb();
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    await svc.restoreFlag({
      flagName: 'x',
      scope: 'global',
      previousValue: null,
    });
    const del = stub.ops.find((o) => o.op === 'delete');
    expect(del).toBeDefined();
  });

  it('updates the row when previousValue is supplied', async () => {
    const stub = makeStubDb();
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    await svc.restoreFlag({
      flagName: 'x',
      scope: 'tenant:acme',
      previousValue: 'old',
    });
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.flagValue).toBe('old');
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    await expect(
      svc.restoreFlag({
        flagName: 'x',
        scope: 'global',
        previousValue: true,
      }),
    ).rejects.toThrow(/boom/);
  });

  it('refuses empty flagName', async () => {
    const stub = makeStubDb();
    const svc = createPlatformFeatureFlagsService(stub.client, deps);
    await expect(
      svc.restoreFlag({
        flagName: '',
        scope: 'global',
        previousValue: null,
      }),
    ).rejects.toThrow(/required/);
  });
});
