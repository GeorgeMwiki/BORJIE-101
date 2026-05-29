/**
 * Tests for InspectionNarrativeService — issue #194 chain C-C.
 *
 * Covers:
 *
 *   1. defaultGenerateNarrative produces bilingual Markdown with
 *      front-matter, summary, findings, and evidence cite.
 *   2. generateForInspection persists + emits a cockpit event.
 *   3. State-machine guards reject invalid jumps.
 *   4. managerApprove → ownerSign → submitToRegulator → markDelivered
 *      runs the full pipeline.
 *   5. Empty-evidence narratives still pass the schema (the auditor
 *      agent rejects them downstream — service stays liberal).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCockpitBusForTests,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../../cockpit-events';
import {
  canTransitionNarrative,
  defaultGenerateNarrative,
  InspectionNarrativeService,
  InspectionNarrativeStateError,
  type AuditEntryInput,
} from '../generator';

const TENANT = 'tnt-test-2';
const INSPECTION = 'ins-test-1';
const ACTOR = 'usr-mgr-1';

// Lightweight in-memory DbLike — same pattern as the regulator suite.
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

function createDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const select = () => ({
    from(_t: unknown) {
      const builder = {
        _filter: null as ((r: Record<string, unknown>) => boolean) | null,
        where(predicate: unknown) {
          builder._filter =
            (predicate as { __testFilter?: typeof builder._filter }).__testFilter ?? null;
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
  const insert = (_t: unknown) => ({
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
  const update = (_t: unknown) => ({
    set(patch: Record<string, unknown>) {
      return {
        where(predicate: unknown) {
          const fn = (predicate as { __testFilter?: (r: Record<string, unknown>) => boolean })
            .__testFilter;
          const targets: Record<string, unknown>[] = [];
          for (const row of rows.values()) {
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
  return { db: { select, insert, update }, rows };
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

describe('defaultGenerateNarrative', () => {
  it('emits bilingual Markdown with front-matter + evidence', async () => {
    const out = await defaultGenerateNarrative({
      inspectionId: INSPECTION,
      inspectionKind: 'safety',
      siteName: 'Mwadui Site 3',
      shiftKind: 'day',
      checklist: [
        { code: 'BRAKES', label: 'Brake system functional', status: 'pass' },
        { code: 'GUARDS', label: 'Drill guard fastened', status: 'fail', note: 'Loose bolt' },
      ],
      notes: 'Followed up with mechanic',
      evidenceIds: ['ev-001', 'ev-002'],
      observedAt: new Date('2026-05-29T07:00:00Z'),
    });
    expect(out.draftMdSw).toContain('Ripoti ya Ukaguzi');
    expect(out.draftMdSw).toContain('Mwadui Site 3');
    expect(out.draftMdEn).toContain('Inspection Report');
    expect(out.draftMdEn).toContain('Loose bolt');
    expect(out.draftMdEn).toContain('ev-001');
    expect(out.llmProvider).toBe('borjie-default');
    expect(out.promptVersion).toBe('v1');
  });
});

describe('InspectionNarrativeService state machine', () => {
  beforeEach(() => __resetCockpitBusForTests());
  afterEach(() => __resetCockpitBusForTests());

  it('refuses invalid jumps', () => {
    expect(canTransitionNarrative('draft', 'owner_signed')).toBe(false);
    expect(canTransitionNarrative('draft', 'manager_ok')).toBe(true);
    expect(canTransitionNarrative('manager_ok', 'owner_signed')).toBe(true);
    expect(canTransitionNarrative('delivered', 'submitted')).toBe(false);
  });

  it('happy path generate → manager_ok → owner_signed → submitted → delivered', async () => {
    const { db } = createDb();
    const audit = fakeAuditSink();
    const events: CockpitEvent[] = [];
    const unsub = subscribeCockpitEvents(TENANT, (e) => events.push(e));

    const svc = new InspectionNarrativeService({
      db: db as never,
      logger: fakeLogger(),
      auditSink: audit.sink,
      newId: () => 'nar-fix-1',
    });

    const created = await svc.generateForInspection({
      tenantId: TENANT,
      inspectionId: INSPECTION,
      inspectionKind: 'safety',
      actorId: ACTOR,
      llm: {
        inspectionId: INSPECTION,
        inspectionKind: 'safety',
        checklist: [],
        evidenceIds: ['ev-x'],
        observedAt: new Date(),
      },
    });
    expect(created.status).toBe('draft');

    const ok = await svc.managerApprove(TENANT, created.id, ACTOR, 'Looks fine');
    expect(ok.status).toBe('manager_ok');
    expect(ok.managerNotes).toBe('Looks fine');

    const signed = await svc.ownerSign({
      tenantId: TENANT,
      narrativeId: created.id,
      actorId: 'owner-1',
      canonicalPdfSha256: 'b'.repeat(64),
    });
    expect(signed.status).toBe('owner_signed');
    expect(signed.ownerSigSha256).toBe('b'.repeat(64));

    const submitted = await svc.submitToRegulator({
      tenantId: TENANT,
      narrativeId: created.id,
      actorId: ACTOR,
      regulator: 'nemc',
      regulatorRef: 'NEMC-2026-001',
    });
    expect(submitted.status).toBe('submitted');
    expect(submitted.regulator).toBe('nemc');

    const delivered = await svc.markDelivered(TENANT, created.id, ACTOR);
    expect(delivered.status).toBe('delivered');

    // 1 generation + 4 transitions
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.every((e) => e.tenantId === TENANT)).toBe(true);
    unsub();
  });

  it('throws on invalid manual jump', async () => {
    const { db } = createDb();
    const audit = fakeAuditSink();
    const svc = new InspectionNarrativeService({
      db: db as never,
      logger: fakeLogger(),
      auditSink: audit.sink,
      newId: () => 'nar-fix-2',
    });
    const row = await svc.generateForInspection({
      tenantId: TENANT,
      inspectionId: INSPECTION,
      inspectionKind: 'environmental',
      actorId: ACTOR,
      llm: {
        inspectionId: INSPECTION,
        inspectionKind: 'environmental',
        checklist: [],
        evidenceIds: [],
        observedAt: new Date(),
      },
    });
    await expect(
      svc.ownerSign({
        tenantId: TENANT,
        narrativeId: row.id,
        actorId: 'owner-2',
        canonicalPdfSha256: 'c'.repeat(64),
      }),
    ).rejects.toThrow(InspectionNarrativeStateError);
  });
});
