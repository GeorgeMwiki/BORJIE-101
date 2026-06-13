/**
 * Incident escalation-notify legs — unit test (Slice A4 detection).
 *
 * `fireEscalationLegs` turns each flag the escalator decided into a durable
 * `notification_dispatch_log` row so the dispatcher delivers it. This suite
 * asserts:
 *   1. notifyManager enqueues one `pending` row per on-call manager, with the
 *      stable `incident-escalate::<id>::manager::<userId>` idempotency key and
 *      ON CONFLICT DO NOTHING.
 *   2. notifyAdminCompliance enqueues a row per admin/compliance recipient.
 *   3. draftRegulatorFiling enqueues a regulator-PREP row (human-gated;
 *      payload.humanGated === true) — never an auto-file.
 *   4. A leg with NO eligible recipients enqueues nothing for that leg.
 *   5. Every INSERT runs inside the service-role context (the GUC binds are
 *      issued before the INSERT) — without it the FORCE-RLS INSERT matches
 *      zero rows.
 *   6. One leg's DB fault is isolated: the other legs still enqueue.
 *
 * The DB is stubbed; only the SQL shape + bound values are exercised. Real
 * integration is covered by the deployed dispatcher draining the rows.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEscalationLegs } from '../incidents.hono';
import {
  escalateIncident,
  buildIncidentNotifyIdempotencyKey,
} from '../../../services/safety-incident/escalator';

interface Captured {
  readonly sql: string;
  readonly values: unknown[];
}

/**
 * Flatten a Drizzle `SQL` object into static text + bound values. Mirrors the
 * helper the announcement-fanout worker test uses: StringChunks rebuild the
 * static text; every other chunk is a bound value.
 */
function flattenSql(q: unknown): { text: string; values: unknown[] } {
  const chunks =
    (q as { queryChunks?: ReadonlyArray<unknown> })?.queryChunks ?? [];
  const textParts: string[] = [];
  const values: unknown[] = [];
  for (const chunk of chunks) {
    const sc = chunk as { value?: unknown };
    if (sc && typeof sc === 'object' && Array.isArray(sc.value)) {
      textParts.push((sc.value as string[]).join(''));
    } else {
      values.push(chunk);
    }
  }
  return { text: textParts.join(' '), values };
}

/**
 * Transaction-capable stub db. `withServiceRoleContext` requires `.transaction`
 * to be a function; it then runs the callback against a `tx` whose `.execute`
 * runs the GUC binds + the SELECT (against `users`) + the INSERT. The SELECT
 * resolves to `selectRows` keyed by which roles the IN-list bound; INSERTs and
 * GUC binds return [].
 */
function makeStubDb(opts: {
  readonly rowsByUser: ReadonlyArray<Record<string, unknown>>;
  readonly failInsertForLeg?: string;
}) {
  const calls: Captured[] = [];
  const tx = {
    execute: vi.fn(async (q: unknown) => {
      const { text, values } = flattenSql(q);
      calls.push({ sql: text, values });
      if (text.includes('FROM users')) {
        return { rows: opts.rowsByUser };
      }
      if (text.includes('INSERT INTO notification_dispatch_log')) {
        // Optionally simulate a per-leg DB fault (matched by the bound
        // template_key / payload carrying the leg name).
        if (
          opts.failInsertForLeg &&
          values.some(
            (v) => typeof v === 'string' && v.includes(opts.failInsertForLeg!),
          )
        ) {
          throw new Error('simulated insert failure');
        }
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
  return {
    calls,
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
}

// Hoisted so the (hoisted) vi.mock factory can reference it without a TDZ.
const stubLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../utils/pino-shim', () => ({
  createPinoLikeLogger: () => stubLogger,
}));

const TENANT = 't-1';
const INCIDENT = 'inc-1';

const managerRow = (id: string, over: Record<string, unknown> = {}) => ({
  user_id: id,
  email: `${id}@example.com`,
  phone: null,
  locale: 'en',
  ...over,
});

function insertCalls(calls: readonly Captured[]): readonly Captured[] {
  return calls.filter((c) =>
    c.sql.includes('INSERT INTO notification_dispatch_log'),
  );
}

function boundKeys(calls: readonly Captured[]): string[] {
  return insertCalls(calls).flatMap((c) =>
    c.values.filter(
      (v): v is string =>
        typeof v === 'string' && v.startsWith('incident-escalate::'),
    ),
  );
}

describe('fireEscalationLegs', () => {
  it('notifyManager enqueues one pending row per on-call manager with stable keys', async () => {
    const db = makeStubDb({ rowsByUser: [managerRow('mgr-a'), managerRow('mgr-b')] });
    const escalation = escalateIncident({ severity: 'high', kind: 'safety' });
    // high → manager + owner pulse, no admin/regulator. Only the manager leg fires.
    expect(escalation.notifyManager).toBe(true);
    expect(escalation.notifyAdminCompliance).toBe(false);

    await fireEscalationLegs(db as unknown as never, {
      tenantId: TENANT,
      incidentId: INCIDENT,
      severity: 'high',
      escalation,
    });

    const keys = boundKeys(db.calls);
    expect(keys).toContain(
      buildIncidentNotifyIdempotencyKey(INCIDENT, 'manager', 'mgr-a'),
    );
    expect(keys).toContain(
      buildIncidentNotifyIdempotencyKey(INCIDENT, 'manager', 'mgr-b'),
    );
    expect(keys).toHaveLength(2);
    // Every INSERT uses ON CONFLICT DO NOTHING.
    for (const c of insertCalls(db.calls)) {
      expect(c.sql).toContain('ON CONFLICT (tenant_id, idempotency_key) DO NOTHING');
    }
  });

  it('critical incident fires all three legs (manager + admin_compliance + regulator_prep)', async () => {
    const db = makeStubDb({ rowsByUser: [managerRow('person-1')] });
    const escalation = escalateIncident({ severity: 'critical', kind: 'environmental' });
    expect(escalation.notifyManager).toBe(true);
    expect(escalation.notifyAdminCompliance).toBe(true);
    expect(escalation.draftRegulatorFiling).toBe(true);

    await fireEscalationLegs(db as unknown as never, {
      tenantId: TENANT,
      incidentId: INCIDENT,
      severity: 'critical',
      escalation,
    });

    const keys = boundKeys(db.calls);
    expect(keys).toContain(
      buildIncidentNotifyIdempotencyKey(INCIDENT, 'manager', 'person-1'),
    );
    expect(keys).toContain(
      buildIncidentNotifyIdempotencyKey(INCIDENT, 'admin_compliance', 'person-1'),
    );
    expect(keys).toContain(
      buildIncidentNotifyIdempotencyKey(INCIDENT, 'regulator_prep', 'person-1'),
    );
  });

  it('regulator_prep is human-gated (payload.humanGated true) and never auto-files', async () => {
    const db = makeStubDb({ rowsByUser: [managerRow('comp-1')] });
    const escalation = escalateIncident({ severity: 'critical', kind: 'safety' });

    await fireEscalationLegs(db as unknown as never, {
      tenantId: TENANT,
      incidentId: INCIDENT,
      severity: 'critical',
      escalation,
    });

    // No regulatory_filings write — the prep leg only enqueues a notification.
    const allSql = db.calls.map((c) => c.sql).join('\n');
    expect(allSql).not.toContain('INSERT INTO regulatory_filings');

    // The regulator-prep payload carries humanGated:true.
    const prepInsert = insertCalls(db.calls).find((c) =>
      c.values.some(
        (v) => typeof v === 'string' && v.includes('"leg":"regulator_prep"'),
      ),
    );
    expect(prepInsert).toBeDefined();
    const payload = prepInsert!.values.find(
      (v) => typeof v === 'string' && v.includes('"humanGated"'),
    ) as string;
    expect(JSON.parse(payload).humanGated).toBe(true);
  });

  it('binds the service-role GUC before the INSERT (FORCE-RLS bypass)', async () => {
    const db = makeStubDb({ rowsByUser: [managerRow('mgr-x')] });
    const escalation = escalateIncident({ severity: 'high', kind: 'safety' });

    await fireEscalationLegs(db as unknown as never, {
      tenantId: TENANT,
      incidentId: INCIDENT,
      severity: 'high',
      escalation,
    });

    const serviceRoleBindIdx = db.calls.findIndex(
      (c) => c.sql.includes('set_config') && c.sql.includes('app.is_service_role'),
    );
    const insertIdx = db.calls.findIndex((c) =>
      c.sql.includes('INSERT INTO notification_dispatch_log'),
    );
    expect(serviceRoleBindIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(serviceRoleBindIdx);
    // The service-role flag is bound 'true'.
    expect(db.calls[serviceRoleBindIdx]!.values).toContain('true');
  });

  it('a leg with no eligible recipients enqueues nothing', async () => {
    const db = makeStubDb({ rowsByUser: [] });
    const escalation = escalateIncident({ severity: 'high', kind: 'safety' });

    await fireEscalationLegs(db as unknown as never, {
      tenantId: TENANT,
      incidentId: INCIDENT,
      severity: 'high',
      escalation,
    });

    expect(insertCalls(db.calls)).toHaveLength(0);
  });

  it('isolates a failing leg — the other legs still enqueue', async () => {
    // Make the manager-leg INSERT throw; admin_compliance + regulator_prep must
    // still enqueue. (failInsertForLeg matches the bound template_key/payload.)
    const db = makeStubDb({
      rowsByUser: [managerRow('p-1')],
      failInsertForLeg: 'escalation.manager',
    });
    const escalation = escalateIncident({ severity: 'critical', kind: 'safety' });

    await expect(
      fireEscalationLegs(db as unknown as never, {
        tenantId: TENANT,
        incidentId: INCIDENT,
        severity: 'critical',
        escalation,
      }),
    ).resolves.toBeUndefined();

    const keys = boundKeys(db.calls);
    // The admin + regulator-prep keys still landed despite the manager fault.
    expect(keys).toContain(
      buildIncidentNotifyIdempotencyKey(INCIDENT, 'admin_compliance', 'p-1'),
    );
    expect(keys).toContain(
      buildIncidentNotifyIdempotencyKey(INCIDENT, 'regulator_prep', 'p-1'),
    );
    // The failing leg was logged, not thrown.
    expect(stubLogger.error).toHaveBeenCalled();
  });

  it('falls back to an in-app push when a recipient has no email/phone', async () => {
    const db = makeStubDb({
      rowsByUser: [managerRow('mgr-noaddr', { email: null, phone: null })],
    });
    const escalation = escalateIncident({ severity: 'high', kind: 'safety' });

    await fireEscalationLegs(db as unknown as never, {
      tenantId: TENANT,
      incidentId: INCIDENT,
      severity: 'high',
      escalation,
    });

    const insert = insertCalls(db.calls)[0];
    expect(insert).toBeDefined();
    expect(insert!.values).toContain('app_push');
    expect(insert!.values).toContain('user:mgr-noaddr');
  });
});
