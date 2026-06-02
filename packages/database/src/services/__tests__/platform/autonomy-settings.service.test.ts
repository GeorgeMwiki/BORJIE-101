/**
 * Unit tests — createPlatformAutonomySettingsService.
 *
 * Coverage:
 *   - setSetting inserts when no existing row, stamps set_by from resolveActor
 *   - setSetting updates + snapshots prev_enabled / prev_int_value when row exists
 *   - setSetting rethrows on DB error (operator must know the write failed)
 *   - restoreSetting deletes when previous=null
 *   - restoreSetting updates when previous supplied
 *   - readSetting returns the row when found, null on miss / DB error
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPlatformAutonomySettingsService } from '../../platform/autonomy-settings.service.js';
import { makeStubDb } from './_stub-db.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const deps = { resolveActor: () => 'operator-1' };

describe('platform.autonomySettings — setSetting', () => {
  it('inserts a new row when none exists + stamps set_by', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    const out = await svc.setSetting({
      settingKey: 'webhook_rate_cap_per_min',
      enabled: false,
      intValue: 300,
      note: 'incident throttle',
    });
    expect(out.enabled).toBe(false);
    expect(out.intValue).toBe(300);
    expect(out.previous).toBeNull();
    const insert = stub.ops.find((o) => o.op === 'insert');
    expect(insert?.values?.settingKey).toBe('webhook_rate_cap_per_min');
    expect(insert?.values?.setBy).toBe('operator-1');
    expect(insert?.values?.enabled).toBe(false);
    expect(insert?.values?.intValue).toBe(300);
  });

  it('updates + snapshots previous enabled/int_value when row exists', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      { enabled: true, intValue: 600, note: 'default' },
    ]);
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    const out = await svc.setSetting({
      settingKey: 'webhook_rate_cap_per_min',
      enabled: false,
      intValue: 100,
      note: null,
    });
    expect(out.previous?.enabled).toBe(true);
    expect(out.previous?.intValue).toBe(600);
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.prevEnabled).toBe(true);
    expect(update?.set?.prevIntValue).toBe(600);
    expect(update?.set?.enabled).toBe(false);
    expect(update?.set?.setBy).toBe('operator-1');
  });

  it('rethrows on DB error (caller must know the write failed)', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    await expect(
      svc.setSetting({
        settingKey: 'embed_token_throttle_per_min',
        enabled: true,
        intValue: 50000,
        note: null,
      }),
    ).rejects.toThrow(/boom/);
  });
});

describe('platform.autonomySettings — restoreSetting', () => {
  it('deletes the row when previous=null', async () => {
    const stub = makeStubDb();
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    await svc.restoreSetting({
      settingKey: 'webhook_rate_cap_per_min',
      previous: null,
    });
    expect(stub.ops.find((o) => o.op === 'delete')).toBeDefined();
  });

  it('updates the row when previous supplied', async () => {
    const stub = makeStubDb();
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    await svc.restoreSetting({
      settingKey: 'webhook_rate_cap_per_min',
      previous: { enabled: true, intValue: 600 },
    });
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.enabled).toBe(true);
    expect(update?.set?.intValue).toBe(600);
  });
});

describe('platform.autonomySettings — readSetting', () => {
  it('returns the row when found', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      { enabled: false, intValue: 250, note: 'paused' },
    ]);
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    const out = await svc.readSetting('webhook_rate_cap_per_min');
    expect(out?.enabled).toBe(false);
    expect(out?.intValue).toBe(250);
  });

  it('returns null on miss', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    expect(await svc.readSetting('webhook_rate_cap_per_min')).toBeNull();
  });

  it('returns null on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformAutonomySettingsService(stub.client, deps);
    expect(await svc.readSetting('webhook_rate_cap_per_min')).toBeNull();
  });
});
