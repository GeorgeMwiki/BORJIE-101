/**
 * GDPR Service tests — Wave 9 enterprise polish.
 *
 * Covers:
 *   - requestDeletion() creates a pending row and emits an event
 *   - getStatus() returns current status
 *   - listRequests() is tenant-scoped
 *   - executeDeletion() generates pseudonymization statements
 *   - pseudonymization preserves id, wipes PII (name/email/phone)
 *   - cross-tenant execute is rejected with TENANT_MISMATCH
 *   - double-execute rejected with ALREADY_EXECUTED
 *   - reject() transitions pending → rejected; can't reject completed
 *   - status transitions pending → completed after execute
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGdprService,
  buildPseudonymizationStatements,
  GdprError,
  type GdprDeletionRequest,
  type GdprRepository,
} from '../gdpr-service.js';

function makeRepo(): {
  repo: GdprRepository;
  rows: GdprDeletionRequest[];
} {
  const rows: GdprDeletionRequest[] = [];
  const repo: GdprRepository = {
    async insert(row) {
      rows.push({ ...row });
      return { ...row };
    },
    async update(row) {
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx < 0) throw new Error(`row ${row.id} missing`);
      rows[idx] = { ...row };
      return { ...row };
    },
    async findById(id, tenantId) {
      const found = rows.find((r) => r.id === id && r.tenantId === tenantId);
      return found ? { ...found } : null;
    },
    async findByIdAny(id) {
      const found = rows.find((r) => r.id === id);
      return found ? { ...found } : null;
    },
    async listByTenant(tenantId) {
      return rows
        .filter((r) => r.tenantId === tenantId)
        .map((r) => ({ ...r }));
    },
  };
  return { repo, rows };
}

function makeEventBus(): {
  bus: { publish: (env: unknown) => Promise<void> };
  events: unknown[];
} {
  const events: unknown[] = [];
  return {
    bus: {
      async publish(env) {
        events.push(env);
      },
    },
    events,
  };
}

const fixedNow = () => new Date('2026-04-19T12:00:00.000Z');
let idCounter = 0;
function resetIds() {
  idCounter = 0;
}
function fixedId() {
  return `req_${++idCounter}`;
}
function fixedPseudonym() {
  return `ps_${++idCounter}`;
}

describe('GdprService.requestDeletion', () => {
  beforeEach(() => resetIds());

  it('creates a pending request', async () => {
    const { repo, rows } = makeRepo();
    const { bus } = makeEventBus();
    const svc = createGdprService({
      repo,
      eventBus: bus as never,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    expect(req.status).toBe('pending');
    expect(req.customerId).toBe('cust_1');
    expect(req.tenantId).toBe('tenant_a');
    expect(req.requestedBy).toBe('admin_1');
    expect(rows).toHaveLength(1);
  });

  it('emits GdprDeletionRequested event', async () => {
    const { repo } = makeRepo();
    const { bus, events } = makeEventBus();
    const svc = createGdprService({
      repo,
      eventBus: bus as never,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    expect(events).toHaveLength(1);
    const env = events[0] as {
      event: { eventType: string; payload: { customerId: string } };
    };
    expect(env.event.eventType).toBe('GdprDeletionRequested');
    expect(env.event.payload.customerId).toBe('cust_1');
  });

  it('rejects empty customerId', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    await expect(
      svc.requestDeletion('tenant_a', { customerId: '' }, 'admin_1'),
    ).rejects.toBeInstanceOf(GdprError);
  });
});

describe('GdprService.getStatus / listRequests', () => {
  beforeEach(() => resetIds());

  it('getStatus returns the pending request', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    const status = await svc.getStatus('tenant_a', req.id);
    expect(status.status).toBe('pending');
  });

  it('getStatus returns NOT_FOUND for unknown id', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    await expect(svc.getStatus('tenant_a', 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('listRequests is tenant-scoped', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    await svc.requestDeletion(
      'tenant_b',
      { customerId: 'cust_x' },
      'admin_2',
    );
    const listA = await svc.listRequests('tenant_a');
    const listB = await svc.listRequests('tenant_b');
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
    expect(listA[0].customerId).toBe('cust_1');
    expect(listB[0].customerId).toBe('cust_x');
  });
});

describe('GdprService.executeDeletion', () => {
  beforeEach(() => resetIds());

  it('transitions pending → completed, attaches pseudonymId', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    const result = await svc.executeDeletion(
      'tenant_a',
      req.id,
      'super_admin_1',
    );
    expect(result.request.status).toBe('completed');
    expect(result.request.pseudonymId).toBeDefined();
    expect(result.pseudonymId).toBeTruthy();
    expect(result.request.executedBy).toBe('super_admin_1');
    expect(result.request.affectedTables.length).toBeGreaterThan(0);
    expect(result.statements.length).toBeGreaterThan(0);
  });

  it('pseudonymization preserves customer id and wipes PII columns', async () => {
    const statements = buildPseudonymizationStatements(
      'tenant_a',
      'cust_1',
      '[DELETED:fake-uuid]',
    );
    // customers table must be hit
    const customersStmt = statements.find((s) => s.table === 'customers');
    expect(customersStmt).toBeDefined();
    // Must wipe name / email / phone
    expect(customersStmt!.sql).toContain('name = $');
    expect(customersStmt!.sql).toContain('email = $');
    expect(customersStmt!.sql).toContain('phone = $');
    // The id column must NOT appear in the SET clause — only the WHERE
    // clause uses it. The SET clause is the referential-integrity
    // invariant we actually care about.
    const setClause = customersStmt!.sql
      .split(' SET ')[1]
      .split(' WHERE ')[0];
    expect(setClause).not.toMatch(/\bid\s*=/);
    // WHERE clause must still scope on id + tenant_id.
    expect(customersStmt!.sql).toContain('WHERE id = $');
    expect(customersStmt!.sql).toContain('tenant_id = $');
    // Pseudonym must appear in params
    expect(customersStmt!.params).toContain('[DELETED:fake-uuid]');
    // Tenant + customer scoping in WHERE
    expect(customersStmt!.params).toContain('cust_1');
    expect(customersStmt!.params).toContain('tenant_a');
  });

  it('cross-tenant execute rejected with TENANT_MISMATCH', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    await expect(
      svc.executeDeletion('tenant_b', req.id, 'super_1'),
    ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
  });

  it('double-execute rejected with ALREADY_EXECUTED', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    await svc.executeDeletion('tenant_a', req.id, 'super_1');
    await expect(
      svc.executeDeletion('tenant_a', req.id, 'super_1'),
    ).rejects.toMatchObject({ code: 'ALREADY_EXECUTED' });
  });

  it('executing a rejected request returns INVALID_STATUS', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    await svc.reject('tenant_a', req.id, 'PII not confirmed', 'admin_1');
    await expect(
      svc.executeDeletion('tenant_a', req.id, 'super_1'),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('pseudonym format is [DELETED:<uuid>]', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: () => 'abc-123',
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    const result = await svc.executeDeletion('tenant_a', req.id, 'super_1');
    const customersStmt = result.statements.find(
      (s) => s.table === 'customers',
    );
    expect(customersStmt!.params).toContain('[DELETED:abc-123]');
  });
});

describe('GdprService.reject', () => {
  beforeEach(() => resetIds());

  it('rejects a pending request with reason', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    const rejected = await svc.reject(
      'tenant_a',
      req.id,
      'customer withdrew',
      'admin_1',
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectedReason).toBe('customer withdrew');
  });

  it('cannot reject a completed request', async () => {
    const { repo } = makeRepo();
    const svc = createGdprService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
      pseudonymGenerator: fixedPseudonym,
    });
    const req = await svc.requestDeletion(
      'tenant_a',
      { customerId: 'cust_1' },
      'admin_1',
    );
    await svc.executeDeletion('tenant_a', req.id, 'super_1');
    await expect(
      svc.reject('tenant_a', req.id, 'changed mind', 'admin_1'),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
});
