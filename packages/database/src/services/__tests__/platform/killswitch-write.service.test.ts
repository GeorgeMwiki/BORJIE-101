/**
 * Unit tests — createPlatformKillswitchWriteService.
 *
 * Coverage:
 *   - writeKillswitch inserts when no existing state, fires cross-portal event
 *   - writeKillswitch updates when state exists, snapshots previous fields
 *   - writeKillswitch rethrows on DB error
 *   - writeKillswitch tolerates cross-portal publisher errors
 *   - restoreKillswitch deletes row when previous=null
 *   - restoreKillswitch updates row when previous supplied
 *   - restoreKillswitch rethrows on DB error
 *   - readCurrent returns the row when found
 *   - readCurrent returns null on miss or DB error
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPlatformKillswitchWriteService } from '../../platform/killswitch-write.service.js';
import { makeStubDb } from './_stub-db.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function buildDeps(args?: {
  publisher?: ReturnType<typeof vi.fn>;
  publisherThrows?: boolean;
}) {
  const publisher = args?.publisher ?? vi.fn(async () => undefined);
  return {
    publisher,
    deps: {
      resolveActor: () => 'operator-1',
      publishCrossPortalEvent: args?.publisherThrows
        ? async () => {
            throw new Error('bus down');
          }
        : (publisher as unknown as (e: unknown) => Promise<void>),
    },
  };
}

describe('platform.killswitch — writeKillswitch', () => {
  it('inserts a new row when no existing state + fires cross-portal event', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const { publisher, deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    const out = await svc.writeKillswitch({
      scope: 'platform',
      level: 'halt',
      reasonCode: 'KILLSWITCH_HALT',
      note: 'incident',
    });
    expect(out.level).toBe('halt');
    expect(out.previous).toBeNull();
    const insert = stub.ops.find((o) => o.op === 'insert');
    expect(insert?.values?.scope).toBe('platform');
    expect(insert?.values?.level).toBe('halt');
    expect(insert?.values?.setBy).toBe('operator-1');
    expect(publisher).toHaveBeenCalledTimes(1);
    expect((publisher.mock.calls[0]?.[0] as { type: string }).type).toBe(
      'killswitch:changed',
    );
  });

  it('updates the row + snapshots previous fields when state exists', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        level: 'live',
        reasonCode: 'PROVIDER_INCIDENT',
        note: 'old',
        prevLevel: null,
        prevReasonCode: null,
        prevNote: null,
        setAt: new Date(),
      },
    ]);
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    const out = await svc.writeKillswitch({
      scope: 'tenant:acme',
      level: 'degraded',
      reasonCode: 'COMPLIANCE_HOLD_CBK',
      note: null,
    });
    expect(out.previous?.level).toBe('live');
    expect(out.previous?.reasonCode).toBe('PROVIDER_INCIDENT');
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.prevLevel).toBe('live');
    expect(update?.set?.level).toBe('degraded');
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    await expect(
      svc.writeKillswitch({
        scope: 'platform',
        level: 'halt',
        reasonCode: 'KILLSWITCH_HALT',
        note: null,
      }),
    ).rejects.toThrow(/boom/);
  });

  it('tolerates cross-portal publisher errors (DB write still succeeds)', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const { deps } = buildDeps({ publisherThrows: true });
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    const out = await svc.writeKillswitch({
      scope: 'platform',
      level: 'halt',
      reasonCode: 'KILLSWITCH_HALT',
      note: null,
    });
    expect(out.level).toBe('halt');
  });
});

describe('platform.killswitch — restoreKillswitch', () => {
  it('deletes the row when previous=null', async () => {
    const stub = makeStubDb();
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    await svc.restoreKillswitch({ scope: 'platform', previous: null });
    const del = stub.ops.find((o) => o.op === 'delete');
    expect(del).toBeDefined();
  });

  it('updates the row when previous supplied', async () => {
    const stub = makeStubDb();
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    await svc.restoreKillswitch({
      scope: 'platform',
      previous: { level: 'live', reasonCode: 'PROVIDER_INCIDENT' },
    });
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.level).toBe('live');
    expect(update?.set?.reasonCode).toBe('PROVIDER_INCIDENT');
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    await expect(
      svc.restoreKillswitch({
        scope: 'platform',
        previous: { level: 'halt', reasonCode: 'KILLSWITCH_HALT' },
      }),
    ).rejects.toThrow(/boom/);
  });
});

describe('platform.killswitch — readCurrent', () => {
  it('returns the row when found', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      { level: 'halt', reasonCode: 'KILLSWITCH_HALT', note: 'down' },
    ]);
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    const out = await svc.readCurrent('platform');
    expect(out?.level).toBe('halt');
    expect(out?.note).toBe('down');
  });

  it('returns null when no row exists', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    expect(await svc.readCurrent('platform')).toBeNull();
  });

  it('returns null on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    expect(await svc.readCurrent('platform')).toBeNull();
  });

  it('returns null when stored level is invalid', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      { level: 'unknown-level', reasonCode: 'KILLSWITCH_HALT', note: null },
    ]);
    const { deps } = buildDeps();
    const svc = createPlatformKillswitchWriteService(stub.client, deps);
    expect(await svc.readCurrent('platform')).toBeNull();
  });
});
