/**
 * Tests for RegulatorRequestService — issue #194 chain C-A.
 *
 * Uses an in-memory DbLike stand-in so the unit suite never depends
 * on Postgres being running. Verifies:
 *
 *   1. create() inserts + emits cockpit + appends audit.
 *   2. State-machine refuses invalid transitions.
 *   3. approveDisclosure flips status + records the scope.
 *   4. attachExport advances to `exported` and stamps SHA-256.
 *   5. markDelivered terminates the workflow.
 *   6. redactSubject / maskPhone / maskEmail produce the right shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCockpitBusForTests,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../../cockpit-events';
import {
  REGULATOR_REQUEST_STATUSES,
  type RegulatorRequestRow,
} from '@borjie/database';
import {
  RegulatorRequestService,
  RegulatorRequestStateError,
  canTransition,
  maskEmail,
  maskNationalId,
  maskPhone,
  redactSubject,
  REGULATOR_SLA_DAYS,
  type AuditEntryInput,
} from '../request-service';

const TENANT = 'tnt-test-1';
const ACTOR = 'usr-actor-1';

// ----------------------------------------------------------------------------
// In-memory DbLike — single-table store keyed by id, scoped to tenant.
// ----------------------------------------------------------------------------

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

function createInMemoryDb() {
  const rows = new Map<string, Record<string, unknown>>();

  const select = () => ({
    from(_table: unknown) {
      const builder = {
        _filter: null as ((row: Record<string, unknown>) => boolean) | null,
        where(predicate: unknown) {
          const fn = (predicate as { __testFilter?: typeof builder._filter })
            .__testFilter;
          if (fn) builder._filter = fn;
          return builder;
        },
        async limit(n: number) {
          const out: Record<string, unknown>[] = [];
          for (const row of rows.values()) {
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

  const insert = (_table: unknown) => ({
    values(row: Record<string, unknown>) {
      const stored = expandKeys(row);
      rows.set(String(row.id), stored);
      return {
        async returning() {
          return [stored];
        },
      };
    },
  });

  const update = (_table: unknown) => ({
    set(patch: Record<string, unknown>) {
      return {
        where(predicate: unknown) {
          const fn = (predicate as { __testFilter?: (r: Record<string, unknown>) => boolean })
            .__testFilter;
          const target: Record<string, unknown>[] = [];
          for (const row of rows.values()) {
            if (fn && !fn(row)) continue;
            target.push(row);
          }
          for (const row of target) {
            Object.assign(row, expandKeys(patch));
          }
          return {
            async returning() {
              return target.map((r) => ({ ...r }));
            },
          };
        },
      };
    },
  });

  return {
    db: { select, insert, update } as unknown as ConstructorParameters<typeof RegulatorRequestService>[0]['db'],
    rows,
  };
}

// `eq()` / `and()` returns opaque drizzle objects; our fake hooks them
// via Object.defineProperty so the in-memory store can filter.
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
      const candidates = [colName, snake];
      for (const k of candidates) {
        if (row[k] === val) return true;
      }
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

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ConstructorParameters<typeof RegulatorRequestService>[0]['logger'];
}

function fakeAuditSink() {
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

function captureEvents(): {
  events: CockpitEvent[];
  unsub: () => void;
} {
  const events: CockpitEvent[] = [];
  const unsub = subscribeCockpitEvents(TENANT, (e) => events.push(e));
  return { events, unsub };
}

describe('RegulatorRequestService', () => {
  beforeEach(() => {
    __resetCockpitBusForTests();
  });

  afterEach(() => {
    __resetCockpitBusForTests();
  });

  it('canTransition matches the documented state machine', () => {
    for (const status of REGULATOR_REQUEST_STATUSES) {
      // Each terminal status should not advance.
      if (status === 'delivered' || status === 'rejected' || status === 'expired') {
        for (const target of REGULATOR_REQUEST_STATUSES) {
          expect(canTransition(status, target)).toBe(false);
        }
      }
    }
    expect(canTransition('received', 'parsed')).toBe(true);
    expect(canTransition('received', 'exported')).toBe(false);
  });

  it('create persists, emits cockpit, and appends audit', async () => {
    const { db } = createInMemoryDb();
    const audit = fakeAuditSink();
    const svc = new RegulatorRequestService({
      db: db as never,
      logger: fakeLogger(),
      auditSink: audit.sink,
      now: () => new Date('2026-05-29T10:00:00Z'),
      newId: () => 'rr-fixed-1',
    });
    const { events, unsub } = captureEvents();

    const row = await svc.create({
      tenantId: TENANT,
      regulator: 'pccb',
      subjectKind: 'worker',
      subjectRef: 'usr-victim-1',
      summaryEn: 'PDPC subject access request',
      summarySw: 'Ombi la PCCB',
      createdBy: ACTOR,
    });

    expect(row.id).toBe('rr-fixed-1');
    expect(row.status).toBe('received');
    expect(row.regulator).toBe('pccb');
    // 30-day PDPC SLA.
    expect(new Date(row.dueAt).getTime() - new Date('2026-05-29T10:00:00Z').getTime()).toBe(
      REGULATOR_SLA_DAYS.pccb * 24 * 60 * 60 * 1000,
    );

    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].action).toBe('regulator.request.create');

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('regulator.request_received');

    unsub();
  });

  it('refuses invalid transitions', async () => {
    const { db } = createInMemoryDb();
    const audit = fakeAuditSink();
    const svc = new RegulatorRequestService({
      db: db as never,
      logger: fakeLogger(),
      auditSink: audit.sink,
      newId: () => 'rr-state-1',
    });
    const row = await svc.create({
      tenantId: TENANT,
      regulator: 'nemc',
      subjectKind: 'site',
      subjectRef: 'site-1',
      createdBy: ACTOR,
    });
    await expect(
      svc.attachExport({
        tenantId: TENANT,
        requestId: row.id,
        responseDocKey: 'k',
        responseDocUrl: 'https://x.test/k',
        responseDocSha256: 'a'.repeat(64),
        actorId: ACTOR,
      }),
    ).rejects.toThrow(RegulatorRequestStateError);
  });

  it('full happy-path advances received → delivered', async () => {
    const { db } = createInMemoryDb();
    const audit = fakeAuditSink();
    const svc = new RegulatorRequestService({
      db: db as never,
      logger: fakeLogger(),
      auditSink: audit.sink,
      newId: () => 'rr-happy-1',
    });
    const created = await svc.create({
      tenantId: TENANT,
      regulator: 'pccb',
      subjectKind: 'worker',
      subjectRef: 'usr-2',
      createdBy: ACTOR,
    });

    const parsed = await svc.markParsed(TENANT, created.id, ACTOR);
    expect(parsed.status).toBe('parsed');

    const review = await svc.openForOwnerReview(TENANT, created.id, ACTOR);
    expect(review.status).toBe('owner_review');

    const approved = await svc.approveDisclosure({
      tenantId: TENANT,
      requestId: created.id,
      approvedScope: { identity: true, contact: true },
      ownerId: 'owner-1',
    });
    expect(approved.status).toBe('disclosure_approved');
    expect(approved.approvedScope).toMatchObject({ identity: true });

    const exporting = await svc.markExporting(TENANT, created.id, ACTOR);
    expect(exporting.status).toBe('exporting');

    const exported = await svc.attachExport({
      tenantId: TENANT,
      requestId: created.id,
      responseDocKey: 'regulator-exports/t/r.json',
      responseDocUrl: 'https://artifacts.borjie.local/r.json',
      responseDocSha256: 'a'.repeat(64),
      actorId: ACTOR,
    });
    expect(exported.status).toBe('exported');
    expect(exported.responseDocSha256).toBe('a'.repeat(64));

    const delivered = await svc.markDelivered({
      tenantId: TENANT,
      requestId: created.id,
      actorId: ACTOR,
    });
    expect(delivered.status).toBe('delivered');
  });
});

describe('regulator redaction helpers', () => {
  it('maskPhone preserves prefix + suffix only', () => {
    expect(maskPhone('+255712345678')).toBe('255***678');
    expect(maskPhone('12')).toBe('***');
  });

  it('maskEmail keeps first char + domain', () => {
    expect(maskEmail('alice@borjie.test')).toBe('a***@borjie.test');
    expect(maskEmail('a@x.io')).toBe('*@x.io');
    expect(maskEmail('noatsign')).toBe('***');
  });

  it('maskNationalId reveals only the last 4', () => {
    expect(maskNationalId('19900101-12-3456')).toBe('***3456');
    expect(maskNationalId('12')).toBe('***');
  });

  it('redactSubject honours scope flags', () => {
    const subject = {
      id: 'usr-1',
      displayName: 'Asha Mwema',
      nationalId: '19900101-12-3456',
      phone: '+255712345678',
      email: 'asha@borjie.test',
      siteId: 'site-1',
      role: 'driller',
      salaryTzs: 850_000,
      polygon: '{"type":"Polygon"}',
    };
    const onlyIdentity = redactSubject(subject, { identity: true });
    expect(onlyIdentity.displayName).toBe('Asha Mwema');
    expect(onlyIdentity.nationalId).toBe('***3456');
    expect(onlyIdentity.salaryTzs).toBeUndefined();

    const compensation = redactSubject(subject, {
      identity: true,
      compensation: true,
    });
    expect(compensation.salaryTzs).toBe(850_000);
  });
});
