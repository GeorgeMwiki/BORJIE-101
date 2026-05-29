/**
 * Tests for LicenceRenewalService — issue #194 chain C-B.
 *
 * Covers:
 *
 *   1. daysUntil() handles null + invalid input safely.
 *   2. nextReminderOffset() picks the right ladder rung.
 *   3. renewalStageFor() maps event + days to a stage.
 *   4. startRenewal() is idempotent across calls.
 *   5. submitRenewal() flips status + stamps URL on the licence row.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCockpitBusForTests,
  subscribeCockpitEvents,
} from '../../cockpit-events';
import {
  LicenceRenewalService,
  daysUntil,
  nextReminderOffset,
  renewalStageFor,
  type AuditEntryInput,
} from '../licence-renewal-service';

const TENANT = 'tnt-test-3';
const LICENCE = 'lic-fix-1';
const ACTOR = 'usr-owner-1';

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('drizzle-orm');
  function readColumnName(col: unknown): string {
    const c = col as Record<string, unknown>;
    if (typeof c.name === 'string') return c.name;
    if (typeof c.columnName === 'string') return c.columnName;
    const meta = c['_'] as Record<string, unknown> | undefined;
    if (meta && typeof meta.name === 'string') return meta.name;
    return '';
  }
  function eq(col: unknown, val: unknown) {
    const colName = readColumnName(col);
    const filter = (row: Record<string, unknown>) => {
      const snake = colName.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      for (const k of [colName, snake]) if (row[k] === val) return true;
      return false;
    };
    return Object.defineProperty({}, '__testFilter', {
      value: filter,
      enumerable: false,
    });
  }
  function and(...filters: Array<{ __testFilter?: (r: Record<string, unknown>) => boolean }>) {
    const fns = filters
      .map((f) => f.__testFilter)
      .filter((f): f is (r: Record<string, unknown>) => boolean => Boolean(f));
    const filter = (row: Record<string, unknown>) => fns.every((f) => f(row));
    return Object.defineProperty({}, '__testFilter', {
      value: filter,
      enumerable: false,
    });
  }
  return { ...actual, eq, and };
});

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function expandKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of Object.keys(row)) {
    const snake = toSnake(k);
    if (snake !== k && !(snake in out)) out[snake] = row[k];
  }
  return out;
}

function createDb(seedLicence: Record<string, unknown>) {
  const licences = new Map<string, Record<string, unknown>>();
  licences.set(String(seedLicence.id), seedLicence);
  const events = new Map<string, Record<string, unknown>>();

  function tableNameOf(t: unknown): 'licences' | 'licence_events' | 'unknown' {
    const obj = t as Record<string, unknown>;
    // Drizzle exposes table columns as object properties keyed by camelCase
    // JS name. `licence_events` has `licenceId`, `licences` does not.
    if ('licenceId' in obj) return 'licence_events';
    if ('expiryDate' in obj) return 'licences';
    return 'unknown';
  }

  const select = () => ({
    from(table: unknown) {
      const which = tableNameOf(table);
      const store = which === 'licences' ? licences : events;
      const builder = {
        _filter: null as ((r: Record<string, unknown>) => boolean) | null,
        where(predicate: unknown) {
          builder._filter =
            (predicate as { __testFilter?: typeof builder._filter }).__testFilter ?? null;
          return builder;
        },
        async limit(n: number) {
          const out: Record<string, unknown>[] = [];
          for (const row of store.values()) {
            if (builder._filter && !builder._filter(row)) continue;
            out.push({ ...row });
            if (out.length >= n) break;
          }
          return out;
        },
        orderBy() {
          return builder;
        },
      };
      return builder;
    },
  });

  const insert = (table: unknown) => ({
    values(row: Record<string, unknown>) {
      const which = tableNameOf(table);
      const store = which === 'licences' ? licences : events;
      const stored = expandKeys(row);
      store.set(String(row.id), stored);
      return {
        async returning() {
          return [stored];
        },
      };
    },
  });

  const update = (table: unknown) => ({
    set(patch: Record<string, unknown>) {
      return {
        where(predicate: unknown) {
          const which = tableNameOf(table);
          const store = which === 'licences' ? licences : events;
          const fn = (predicate as { __testFilter?: (r: Record<string, unknown>) => boolean })
            .__testFilter;
          const targets: Record<string, unknown>[] = [];
          for (const row of store.values()) {
            if (fn && !fn(row)) continue;
            targets.push(row);
          }
          for (const row of targets) Object.assign(row, expandKeys(patch));
          return {
            async returning() {
              return targets.map((r) => ({ ...r }));
            },
          };
        },
      };
    },
  });

  return { db: { select, insert, update }, licences, events };
}

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

function fakeAudit() {
  const calls: AuditEntryInput[] = [];
  let seq = 0;
  return {
    calls,
    sink: {
      async append(entry: AuditEntryInput) {
        calls.push(entry);
        seq += 1;
        return { sequenceNumber: seq };
      },
    },
  };
}

describe('LicenceRenewalService pure helpers', () => {
  it('daysUntil returns null for missing input', () => {
    expect(daysUntil(new Date(), null)).toBeNull();
    expect(daysUntil(new Date(), 'not-a-date')).toBeNull();
  });

  it('daysUntil rounds up days', () => {
    const now = new Date('2026-05-29T00:00:00Z');
    const exp = new Date('2026-06-28T00:00:00Z');
    expect(daysUntil(now, exp)).toBe(30);
  });

  it('nextReminderOffset returns the highest crossed rung', () => {
    expect(nextReminderOffset(120)).toBeNull();
    // 89 days remaining → still inside the 90d band.
    expect(nextReminderOffset(89)).toBe(90);
    // Exactly 30 days → 30d band.
    expect(nextReminderOffset(30)).toBe(30);
    expect(nextReminderOffset(1)).toBe(1);
    // Past expiry → returns the topmost band that still satisfies the
    // predicate (90). The watcher treats past-expiry as already
    // crossed for every rung.
    expect(nextReminderOffset(-5)).toBe(90);
  });

  it('renewalStageFor maps events to stages', () => {
    expect(renewalStageFor(null, null)).toBe('no_action');
    expect(renewalStageFor(120, null)).toBe('no_action');
    expect(renewalStageFor(60, null)).toBe('reminder');
    expect(
      renewalStageFor(60, {
        status: 'in_progress',
      } as never),
    ).toBe('drafting');
    expect(
      renewalStageFor(60, {
        status: 'completed',
      } as never),
    ).toBe('renewed');
  });
});

describe('LicenceRenewalService write surface', () => {
  beforeEach(() => __resetCockpitBusForTests());
  afterEach(() => __resetCockpitBusForTests());

  it('startRenewal is idempotent', async () => {
    const licenceRow = {
      id: LICENCE,
      tenant_id: TENANT,
      tenantId: TENANT,
      number: 'PL-001',
      kind: 'PL',
      status: 'active',
      expiry_date: '2026-08-29',
      expiryDate: '2026-08-29',
      fees: {},
    };
    const { db } = createDb(licenceRow);
    const audit = fakeAudit();
    const svc = new LicenceRenewalService({
      db: db as never,
      logger: fakeLogger(),
      auditSink: audit.sink,
      newId: () => 'le-fix-1',
      now: () => new Date('2026-05-29T00:00:00Z'),
    });

    const first = await svc.startRenewal({
      tenantId: TENANT,
      licenceId: LICENCE,
      actorId: ACTOR,
    });
    const second = await svc.startRenewal({
      tenantId: TENANT,
      licenceId: LICENCE,
      actorId: ACTOR,
    });
    expect(first.id).toBe('le-fix-1');
    expect(second.id).toBe('le-fix-1');
    expect(audit.calls).toHaveLength(1);
  });

  it('submitRenewal flips status, stamps URL, audits', async () => {
    const licenceRow = {
      id: LICENCE,
      tenant_id: TENANT,
      tenantId: TENANT,
      number: 'PL-002',
      kind: 'PL',
      status: 'active',
      expiry_date: '2026-07-29',
      expiryDate: '2026-07-29',
      fees: { annual_fee_tzs: 100_000 },
    };
    const { db, licences } = createDb(licenceRow);
    const audit = fakeAudit();
    const svc = new LicenceRenewalService({
      db: db as never,
      logger: fakeLogger(),
      auditSink: audit.sink,
      newId: () => 'le-fix-2',
      now: () => new Date('2026-05-29T00:00:00Z'),
    });

    await svc.startRenewal({
      tenantId: TENANT,
      licenceId: LICENCE,
      actorId: ACTOR,
    });
    const events: unknown[] = [];
    subscribeCockpitEvents(TENANT, (e) => events.push(e));
    const submitted = await svc.submitRenewal({
      tenantId: TENANT,
      licenceId: LICENCE,
      actorId: ACTOR,
      submissionReference: 'NEMC-REF-9',
      renewalDocUrl: 'https://artifacts.borjie.local/r.pdf',
    });
    expect(submitted.status).toBe('completed');
    const updatedLicence = licences.get(LICENCE);
    expect(
      (updatedLicence?.fees as Record<string, unknown> | undefined)
        ?.renewal_doc_url,
    ).toBe('https://artifacts.borjie.local/r.pdf');
    expect(audit.calls.some((c) => c.action === 'licence.renewal.submit')).toBe(
      true,
    );
    expect(events).toHaveLength(1);
  });
});
