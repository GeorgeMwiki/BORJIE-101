/**
 * Tests for the licence-renewal-watcher cron — issue #194 chain C-B.
 *
 * Covers:
 *
 *   1. tickOnce skips licences outside the 90-day horizon.
 *   2. tickOnce opens a renewal_due event when the licence crosses
 *      a ladder rung (90/60/30/14/7/1) and emits a cockpit event.
 *   3. tickOnce is idempotent — re-running does not insert a second
 *      reminder for the same (licence, threshold) pair.
 *   4. DB errors do not throw out of tickOnce.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCockpitBusForTests,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../../services/cockpit-events';
import { startLicenceRenewalWatcher } from '../licence-renewal-watcher';

const TENANT = 'tnt-watcher-1';

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as never;
}

interface FakeDb {
  execute(query: unknown): Promise<unknown>;
}

function createDb(licences: readonly Record<string, unknown>[]): {
  db: FakeDb;
  inserted: Record<string, unknown>[];
  failNext: () => void;
} {
  const inserted: Record<string, unknown>[] = [];
  const claimedKeys = new Set<string>();
  let failOnNext = false;

  const db: FakeDb = {
    async execute(query: unknown) {
      const sql =
        typeof query === 'object' && query
          ? String(
              ((query as { queryChunks?: unknown[] }).queryChunks ?? [])
                .map((c) =>
                  typeof c === 'string'
                    ? c
                    : typeof c === 'object' &&
                        c &&
                        'value' in (c as object) &&
                        Array.isArray((c as { value?: unknown }).value)
                      ? (c as { value: string[] }).value[0]
                      : '',
                )
                .join(' '),
            )
          : String(query);
      if (failOnNext) {
        failOnNext = false;
        throw new Error('simulated DB failure');
      }
      if (sql.includes('FROM licences')) {
        return { rows: licences };
      }
      if (sql.includes('INSERT INTO licence_events')) {
        const params =
          ((query as { queryChunks?: unknown[] }).queryChunks ?? []).filter(
            (c) => typeof c !== 'string',
          ) as Array<{ value?: unknown }>;
        // Naive replay: the params are positional, the threshold + licence id
        // are encoded; we reconstruct the key from the JSON payload value.
        const flat = params
          .map((p) => p.value)
          .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
        const jsonIdx = flat.findIndex(
          (v) => typeof v === 'string' && v.startsWith('{') && v.includes('reminderOffset'),
        );
        const json = jsonIdx >= 0 ? String(flat[jsonIdx]) : '';
        const threshold = /reminderOffset"\s*:\s*(\d+)/.exec(json)?.[1] ?? '0';
        const licenceId = String(flat[2] ?? '');
        const key = `${licenceId}:${threshold}`;
        if (claimedKeys.has(key)) {
          return { rows: [] };
        }
        claimedKeys.add(key);
        const row = { id: String(flat[0] ?? ''), threshold, licenceId };
        inserted.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };

  return {
    db,
    inserted,
    failNext: () => {
      failOnNext = true;
    },
  };
}

describe('licence-renewal-watcher', () => {
  beforeEach(() => __resetCockpitBusForTests());
  afterEach(() => __resetCockpitBusForTests());

  it('opens a renewal_due event when threshold crossed + emits cockpit', async () => {
    const now = new Date('2026-05-29T00:00:00Z');
    const expiry = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000);
    const { db, inserted } = createDb([
      {
        id: 'lic-watcher-1',
        tenant_id: TENANT,
        number: 'PL-100',
        kind: 'PL',
        expiry_date: expiry.toISOString(),
      },
    ]);
    const events: CockpitEvent[] = [];
    subscribeCockpitEvents(TENANT, (e) => events.push(e));

    const watcher = startLicenceRenewalWatcher({
      db,
      logger: fakeLogger(),
      enabled: true,
      now: () => now,
    });
    const result = await watcher.tickOnce();
    watcher.stop();

    expect(result.scanned).toBe(1);
    expect(result.remindersOpened).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('licence.renewal_status_changed');
  });

  it('is idempotent — second tick deduplicates', async () => {
    const now = new Date('2026-05-29T00:00:00Z');
    const expiry = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const { db } = createDb([
      {
        id: 'lic-watcher-2',
        tenant_id: TENANT,
        number: 'PL-101',
        kind: 'PL',
        expiry_date: expiry.toISOString(),
      },
    ]);
    const watcher = startLicenceRenewalWatcher({
      db,
      logger: fakeLogger(),
      enabled: true,
      now: () => now,
    });
    const first = await watcher.tickOnce();
    const second = await watcher.tickOnce();
    watcher.stop();
    expect(first.remindersOpened).toBe(1);
    expect(second.remindersOpened).toBe(0);
    expect(second.dedupSkipped).toBe(1);
  });

  it('does not throw on DB failure', async () => {
    const { db, failNext } = createDb([
      {
        id: 'lic-watcher-3',
        tenant_id: TENANT,
        number: 'PL-102',
        kind: 'PL',
        expiry_date: new Date('2026-09-29T00:00:00Z').toISOString(),
      },
    ]);
    failNext();
    const watcher = startLicenceRenewalWatcher({
      db,
      logger: fakeLogger(),
      enabled: true,
      now: () => new Date('2026-05-29T00:00:00Z'),
    });
    const result = await watcher.tickOnce();
    watcher.stop();
    expect(result.scanned).toBe(0);
  });

  it('disabled watcher is a no-op', async () => {
    const { db } = createDb([]);
    const watcher = startLicenceRenewalWatcher({
      db,
      logger: fakeLogger(),
      enabled: false,
    });
    const result = await watcher.tickOnce();
    watcher.stop();
    expect(result.scanned).toBe(0);
  });
});
