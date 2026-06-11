/**
 * workforce-deps-wiring.test.ts — locks the dark-synapse composition:
 *
 *   1. createWorkforceDeps returns a complete WorkforceDeps bundle (store /
 *      channel / audit / content / tickets / clock / uuid) and emits the
 *      boot-proof signal (the synapse going dark again is detectable);
 *   2. the store getEmployee maps the live `employees` row → the orchestrator
 *      Employee view; insertAssignment issues an INSERT INTO mining_tasks;
 *   3. the channel send enqueues an app_push into notification_dispatch_log
 *      (the deliver-in-app synapse) and honest-degrades to a log sink when
 *      notifications are null (never throws);
 *   4. the audit adapter appends a hash-chained ai_audit_chain row;
 *   5. degraded mode (db === null) composes safely — getEmployee → null,
 *      nothing throws.
 */

import { describe, expect, it } from 'vitest';

import {
  createWorkforceChannelAdapter,
  createWorkforceDeps,
  createWorkforceStore,
  createWorkforceAuditChain,
  type NotificationsPort,
} from '../workforce-deps-wiring';
import type { PinoLikeLogger } from '../../../utils/pino-shim';
import type { WorkAssignment } from '@borjie/workforce-orchestrator';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface LogRecord {
  readonly level: 'info' | 'warn' | 'error';
  readonly meta: Record<string, unknown>;
  readonly msg: string;
}

function fakeLogger(): PinoLikeLogger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  const push =
    (level: LogRecord['level']) =>
    (meta: object, msg?: string): void => {
      records.push({
        level,
        meta: meta as Record<string, unknown>,
        msg: msg ?? '',
      });
    };
  return {
    records,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}

interface CapturedExec {
  readonly sql: string;
}

/**
 * A bare `{ execute }` db stub. withTenantContext/withServiceRoleContext run
 * the callback directly when `.transaction` is absent (no RLS to bind), so the
 * SQL the store/audit issues is captured here. `queryResult` lets a test seed
 * the rows a SELECT returns.
 */
function fakeDb(
  queryResult: (sqlText: string) => ReadonlyArray<Record<string, unknown>>,
): { execute: (q: unknown) => Promise<unknown>; readonly calls: CapturedExec[] } {
  const calls: CapturedExec[] = [];
  return {
    calls,
    async execute(q: unknown): Promise<unknown> {
      // drizzle sql`` template → reconstruct a coarse text for assertions.
      const text = sqlTextOf(q);
      calls.push({ sql: text });
      return { rows: queryResult(text) };
    },
  };
}

function sqlTextOf(q: unknown): string {
  const anyQ = q as { queryChunks?: unknown[]; sql?: string };
  if (typeof anyQ?.sql === 'string') return anyQ.sql;
  // drizzle SQL objects expose `queryChunks`; join their string parts.
  const chunks = anyQ?.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks
      .map((c) => {
        const cc = c as { value?: unknown };
        return Array.isArray(cc?.value) ? cc.value.join(' ') : '';
      })
      .join(' ');
  }
  return String(q);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createWorkforceDeps — the dark synapse, lit', () => {
  it('composes a complete WorkforceDeps bundle + boot-proof signal', () => {
    const logger = fakeLogger();
    const deps = createWorkforceDeps({
      db: fakeDb(() => []) as never,
      logger,
    });

    expect(typeof deps.store.getEmployee).toBe('function');
    expect(typeof deps.channel.send).toBe('function');
    expect(typeof deps.audit.append).toBe('function');
    expect(typeof deps.content.generateCoaching).toBe('function');
    expect(typeof deps.tickets.createTicket).toBe('function');
    expect(deps.clock()).toBeInstanceOf(Date);
    expect(typeof deps.uuid()).toBe('string');

    const boot = logger.records.find(
      (r) => r.meta.wiring === 'workforce-deps' && r.level === 'info',
    );
    expect(boot).toBeDefined();
    expect(boot?.meta.assignmentTable).toBe('mining_tasks');
    expect(boot?.meta.deliverRail).toContain('notification_dispatch_log');
  });

  it('store.getEmployee maps a live employees row → orchestrator Employee', async () => {
    const logger = fakeLogger();
    const db = fakeDb((text) =>
      /FROM employees/.test(text)
        ? [{ id: 'emp_1', tenant_id: 't1', user_id: 'user_9', status: 'active' }]
        : [],
    );
    const store = createWorkforceStore({ db: db as never, logger });
    const employee = await store.getEmployee('t1', 'emp_1');
    expect(employee).not.toBeNull();
    expect(employee?.id).toBe('emp_1');
    // personEntityId maps from the live user_id (the push target).
    expect(employee?.personEntityId).toBe('user_9');
    expect(employee?.status).toBe('active');
    expect(employee?.defaultChannel).toBe('mobile');
  });

  it('store.insertAssignment issues INSERT INTO mining_tasks', async () => {
    const logger = fakeLogger();
    const db = fakeDb(() => []);
    const store = createWorkforceStore({ db: db as never, logger });
    const assignment: WorkAssignment = {
      id: 'task_1',
      tenantId: 't1',
      missionId: null,
      title: 'Inspect pit ramp',
      description: 'Walk the south ramp and flag loose rock.',
      assignedEmployeeId: 'user_9',
      assignedByUserId: 'mwikila',
      priority: 'high',
      dueAt: null,
      estimatedEffortHours: null,
      status: 'pending',
      riskTier: 'LOW',
      hitlRequired: false,
      assetRefs: ['ev_1'],
      createdByPersonaId: 'mwikila',
      auditChainId: 'chain_1',
      completedAt: null,
    };
    const out = await store.insertAssignment(assignment);
    expect(out.id).toBe('task_1');
    const insert = db.calls.find((c) => /INSERT INTO mining_tasks/.test(c.sql));
    expect(insert).toBeDefined();
  });

  it('channel.send enqueues an app_push into notification_dispatch_log', async () => {
    const logger = fakeLogger();
    const sent: Array<Record<string, unknown>> = [];
    const notifications: NotificationsPort = {
      async enqueueAppPush(input) {
        sent.push({ ...input });
        return { accepted: true };
      },
    };
    const channel = createWorkforceChannelAdapter({ notifications, logger });
    const result = await channel.send({
      tenantId: 't1',
      employeeId: 'user_9',
      channel: 'mobile',
      template: 'workforce.new_assignment',
      payload: { assignmentId: 'task_1', title: 'Inspect pit ramp' },
    });
    expect(result.delivered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.templateKey).toBe('workforce.new_assignment');
    expect(String(sent[0]?.idempotencyKey)).toContain('task_1');
  });

  it('channel.send honest-degrades to a log sink when notifications is null', async () => {
    const logger = fakeLogger();
    const channel = createWorkforceChannelAdapter({
      notifications: null,
      logger,
    });
    const result = await channel.send({
      tenantId: 't1',
      employeeId: 'user_9',
      channel: 'mobile',
      template: 'workforce.new_assignment',
      payload: {},
    });
    expect(result.delivered).toBe(false);
    expect(
      logger.records.some((r) => r.meta.organ === 'workforce-channel'),
    ).toBe(true);
  });

  it('audit.append writes a hash-chained ai_audit_chain row', async () => {
    const logger = fakeLogger();
    const db = fakeDb((text) =>
      /SELECT COALESCE\(MAX\(sequence_id\)/.test(text)
        ? [{ max_seq: 4, last_hash: 'abc' }]
        : [],
    );
    const audit = createWorkforceAuditChain({ db: db as never, logger });
    const out = await audit.append({
      tenantId: 't1',
      action: 'workforce.assign_task',
      payload: { title: 'Inspect pit ramp' },
    });
    expect(typeof out.chainId).toBe('string');
    const insert = db.calls.find((c) =>
      /INSERT INTO ai_audit_chain/.test(c.sql),
    );
    expect(insert).toBeDefined();
  });

  it('degraded mode (db === null) composes safely — getEmployee → null', async () => {
    const logger = fakeLogger();
    const deps = createWorkforceDeps({ db: null, logger });
    expect(await deps.store.getEmployee('t1', 'emp_1')).toBeNull();
    // The audit + tickets honest-degrade to synthetic ids without throwing.
    const audit = await deps.audit.append({
      tenantId: 't1',
      action: 'workforce.assign_task',
      payload: {},
    });
    expect(typeof audit.chainId).toBe('string');
    const ticket = await deps.tickets.createTicket({
      tenantId: 't1',
      title: 'x',
      description: 'y',
      assigneeUserId: 'user_9',
      severity: 'high',
      sourceRef: 'task_1',
    });
    expect(typeof ticket.ticketId).toBe('string');
    expect(
      logger.records.some((r) => r.meta.wiring === 'workforce-deps'),
    ).toBe(true);
  });
});
