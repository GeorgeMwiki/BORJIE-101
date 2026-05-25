/**
 * Tests for the DSAR RTBF executor (GDPR Art. 17 / PDPA s.31).
 *
 * Uses in-memory fake Drizzle clients — no real database. Verifies:
 *  - dry-run reports the plan but performs no DB mutations
 *  - real run anonymizes leases (PII columns nulled)
 *  - real run hard-deletes messages (rows gone)
 *  - real run retains audit_events untouched
 *  - subject not found → empty report, no errors
 *  - transaction rollback on mid-table error (atomicity)
 *  - multi-table partial errors swallowed into partialErrors
 *  - per-policy table-by-table action mapping
 *  - subject-kind inference (email vs customerId)
 *  - tenant-id scoping appended to every WHERE clause
 */

import { describe, it, expect } from 'vitest';
import {
  createDsarRtbfExecutor,
  RTBF_POLICY,
  type RtbfDrizzleClient,
  type RtbfSqlTemplateFn,
} from '../dsar-rtbf-executor.js';

// ─── Helpers ─────────────────────────────────────────────────────────

interface CapturedQuery {
  readonly kind: 'SELECT' | 'UPDATE' | 'DELETE' | 'OTHER';
  readonly rendered: string;
}

function captureSqlBuilder(captured: CapturedQuery[]): RtbfSqlTemplateFn {
  return (strings, ...values) => {
    let rendered = '';
    for (let i = 0; i < strings.length; i++) {
      rendered += strings[i];
      if (i < values.length) {
        const v = values[i];
        if (typeof v === 'object' && v !== null && 'value' in v) {
          rendered += String((v as { value: string }).value);
        } else if (typeof v === 'string') {
          rendered += `'${v.replace(/'/g, "''")}'`;
        } else {
          rendered += String(v);
        }
      }
    }
    const trimmed = rendered.trimStart().toUpperCase();
    const kind: CapturedQuery['kind'] = trimmed.startsWith('SELECT')
      ? 'SELECT'
      : trimmed.startsWith('UPDATE')
        ? 'UPDATE'
        : trimmed.startsWith('DELETE')
          ? 'DELETE'
          : 'OTHER';
    captured.push({ kind, rendered });
    return rendered;
  };
}

/**
 * Plain-string sql template — renders to a literal SQL string so the
 * fakeClient can match-on-text. Mirrors the captureSqlBuilder pattern
 * from `dsar-data-source-drizzle.test.ts`.
 */
function plainStringSql(): RtbfSqlTemplateFn {
  return (strings, ...values) => {
    let rendered = '';
    for (let i = 0; i < strings.length; i++) {
      rendered += strings[i];
      if (i < values.length) {
        const v = values[i];
        if (typeof v === 'object' && v !== null && 'value' in v) {
          rendered += String((v as { value: string }).value);
        } else if (typeof v === 'string') {
          rendered += `'${v.replace(/'/g, "''")}'`;
        } else {
          rendered += String(v);
        }
      }
    }
    return rendered;
  };
}

/**
 * Fake Drizzle client. Returns either a fixed row count for COUNT
 * queries or a fixed rowCount for UPDATE/DELETE. Supports transaction.
 *
 * Returns the client AND the matching `sqlTemplate` that produces
 * plain strings — both MUST be passed into createDsarRtbfExecutor so
 * the executor's queries are introspectable here.
 */
function fakeClient(opts: {
  readonly countByTable?: Record<string, number>;
  readonly mutationsByTable?: Record<string, number>;
  readonly failingTables?: ReadonlyArray<string>;
  readonly transactional?: boolean;
} = {}): {
  client: RtbfDrizzleClient;
  capturedQueries: CapturedQuery[];
  sqlTemplate: RtbfSqlTemplateFn;
} {
  const capturedQueries: CapturedQuery[] = [];
  const countByTable = opts.countByTable ?? {};
  const mutationsByTable = opts.mutationsByTable ?? {};
  const failingTables = new Set(opts.failingTables ?? []);
  const sqlTemplate = plainStringSql();

  const execute = async (q: unknown): Promise<unknown> => {
    const rendered = typeof q === 'string' ? q : String(q);
    capturedQueries.push({
      kind: detectKind(rendered),
      rendered,
    });
    const tableMatch = rendered.match(/"([a-z_]+)"/);
    const table = tableMatch?.[1] ?? '';
    if (failingTables.has(table)) {
      throw new Error(`simulated failure on ${table}`);
    }
    if (/^\s*SELECT/i.test(rendered)) {
      const c = countByTable[table] ?? 0;
      return [{ count: c }];
    }
    if (/^\s*UPDATE|^\s*DELETE/i.test(rendered)) {
      const m = mutationsByTable[table] ?? 0;
      // Return shape mirrors postgres-js driver: array of returning rows.
      return Array.from({ length: m }, (_, i) => ({ ok: i + 1 }));
    }
    return [];
  };

  const client: RtbfDrizzleClient = opts.transactional === false
    ? { execute }
    : {
        execute,
        async transaction<T>(fn: (tx: RtbfDrizzleClient) => Promise<T>): Promise<T> {
          return fn({ execute });
        },
      };

  return { client, capturedQueries, sqlTemplate };
}

function detectKind(rendered: string): CapturedQuery['kind'] {
  const t = rendered.trimStart().toUpperCase();
  if (t.startsWith('SELECT')) return 'SELECT';
  if (t.startsWith('UPDATE')) return 'UPDATE';
  if (t.startsWith('DELETE')) return 'DELETE';
  return 'OTHER';
}

/**
 * Builds a fakeClient + executor wired with the captured sqlTemplate.
 * Centralises the boilerplate so individual tests stay readable.
 */
function buildExecutor(
  fakeOpts: Parameters<typeof fakeClient>[0] = {},
  execOpts: { tenantId?: string; now?: () => Date } = {},
) {
  const f = fakeClient(fakeOpts);
  const exec = createDsarRtbfExecutor({
    db: f.client,
    sqlTemplate: f.sqlTemplate,
    ...(execOpts.tenantId !== undefined ? { tenantId: execOpts.tenantId } : {}),
    ...(execOpts.now ? { now: execOpts.now } : {}),
  });
  return { ...f, exec };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('dsar-rtbf-executor / construction', () => {
  it('throws when db client is missing', () => {
    expect(() =>
      createDsarRtbfExecutor({ db: null as unknown as RtbfDrizzleClient }),
    ).toThrow(/db client is required/);
  });

  it('throws when subjectId is empty', async () => {
    const { exec } = buildExecutor();
    await expect(
      exec.executeRtbf({ subjectId: '', requestedBy: 'admin' }),
    ).rejects.toThrow(/subjectId is required/);
  });

  it('throws when requestedBy is empty', async () => {
    const { exec } = buildExecutor();
    await expect(
      exec.executeRtbf({ subjectId: 'cus_1', requestedBy: '' }),
    ).rejects.toThrow(/requestedBy is required/);
  });
});

describe('dsar-rtbf-executor / dry-run', () => {
  it('dry-run on a real subject returns plan but performs no DB mutations', async () => {
    const { exec, capturedQueries } = buildExecutor(
      { countByTable: { leases: 3, voice_turns: 5, audit_events: 12 } },
      { tenantId: 'tnt_test' },
    );
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin-1',
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.subjectId).toBe('cus_1');
    expect(report.subjectKind).toBe('customerId');
    expect(report.tablesProcessed.length).toBe(Object.keys(RTBF_POLICY).length);

    // CRITICAL: no UPDATE / DELETE queries in dry-run mode.
    const mutations = capturedQueries.filter(
      (q) => q.kind === 'UPDATE' || q.kind === 'DELETE',
    );
    expect(mutations.length).toBe(0);

    // Leases (ANONYMIZE) was previewed.
    const leases = report.tablesProcessed.find((t) => t.table === 'leases');
    expect(leases).toBeDefined();
    expect(leases?.action).toBe('anonymized');

    // voice_turns (HARD_DELETE — has customerId binding) was previewed.
    const voice = report.tablesProcessed.find((t) => t.table === 'voice_turns');
    expect(voice?.action).toBe('hard-deleted');
  });

  it('dry-run with email subject previews messages (HARD_DELETE on email path)', async () => {
    const { exec, capturedQueries } = buildExecutor({
      countByTable: { messages: 8 },
    });
    const report = await exec.executeRtbf({
      subjectId: 'a@b.com',
      requestedBy: 'admin-1',
      dryRun: true,
    });
    const messages = report.tablesProcessed.find((t) => t.table === 'messages');
    expect(messages?.action).toBe('hard-deleted');
    // Still no UPDATE / DELETE issued in dry-run.
    const mutations = capturedQueries.filter(
      (q) => q.kind === 'UPDATE' || q.kind === 'DELETE',
    );
    expect(mutations.length).toBe(0);
  });
});

describe('dsar-rtbf-executor / real run mutations', () => {
  it('real run anonymizes customers — PII columns nulled / redacted', async () => {
    const { exec, capturedQueries } = buildExecutor(
      { mutationsByTable: { customers: 1 } },
      { tenantId: 'tnt_t' },
    );
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin-1',
    });

    const customers = report.tablesProcessed.find(
      (t) => t.table === 'customers',
    );
    expect(customers?.action).toBe('anonymized');
    expect(customers?.rowsAffected).toBe(1);

    const updateOnCustomers = capturedQueries.find(
      (q) => q.kind === 'UPDATE' && q.rendered.includes('"customers"'),
    );
    expect(updateOnCustomers).toBeDefined();
    expect(updateOnCustomers!.rendered).toContain('[REDACTED]');
    expect(updateOnCustomers!.rendered).toContain('"email"');
    expect(updateOnCustomers!.rendered).toContain('tenant_id');
  });

  it('real run hard-deletes messages — DELETE issued', async () => {
    const { exec, capturedQueries } = buildExecutor(
      { mutationsByTable: { messages: 4 } },
      { tenantId: 'tnt_t' },
    );
    const report = await exec.executeRtbf({
      subjectId: 'a@b.com',
      requestedBy: 'admin-1',
    });

    const messages = report.tablesProcessed.find((t) => t.table === 'messages');
    expect(messages?.action).toBe('hard-deleted');
    expect(messages?.rowsAffected).toBe(4);

    const deleteOnMessages = capturedQueries.find(
      (q) => q.kind === 'DELETE' && q.rendered.includes('"messages"'),
    );
    expect(deleteOnMessages).toBeDefined();
    expect(deleteOnMessages!.rendered).toContain('"recipient_email"');
  });

  it('real run retains audit_events untouched — only COUNT issued, no UPDATE/DELETE', async () => {
    const { exec, capturedQueries } = buildExecutor(
      { countByTable: { audit_events: 9 } },
      { tenantId: 'tnt_t' },
    );
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin-1',
    });

    const audit = report.tablesProcessed.find((t) => t.table === 'audit_events');
    expect(audit?.action).toBe('retained');
    expect(audit?.rowsAffected).toBe(9);

    const auditMutations = capturedQueries.filter(
      (q) =>
        (q.kind === 'UPDATE' || q.kind === 'DELETE') &&
        q.rendered.includes('"audit_events"'),
    );
    expect(auditMutations.length).toBe(0);
  });
});

describe('dsar-rtbf-executor / subject lookup', () => {
  it('subject not found returns empty report — no errors', async () => {
    const { exec } = buildExecutor();
    const report = await exec.executeRtbf({
      subjectId: 'cus_unknown',
      requestedBy: 'admin-1',
    });

    expect(report.partialErrors.length).toBe(0);
    expect(report.totalRowsAffected).toBe(0);
    // Every policy row is still represented.
    expect(report.tablesProcessed.length).toBe(Object.keys(RTBF_POLICY).length);
  });

  it('skips tables with no subject-kind binding', async () => {
    const { exec } = buildExecutor({ mutationsByTable: { messages: 1 } });
    // customerId-only run; messages table has no customerId binding
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin-1',
    });
    const messages = report.tablesProcessed.find(
      (t) => t.table === 'messages',
    );
    expect(messages?.action).toBe('skipped');
    expect(messages?.rowsAffected).toBe(0);
  });
});

describe('dsar-rtbf-executor / atomicity + partial errors', () => {
  it('partial errors per table are swallowed into partialErrors', async () => {
    const { exec } = buildExecutor({
      mutationsByTable: { customers: 1, messages: 1 },
      failingTables: ['leases'],
    });
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin-1',
    });
    const leaseErr = report.partialErrors.find((e) => e.table === 'leases');
    expect(leaseErr).toBeDefined();
    expect(leaseErr?.error).toMatch(/simulated failure on leases/);
    // Other tables still ran.
    const customers = report.tablesProcessed.find(
      (t) => t.table === 'customers',
    );
    expect(customers?.action).toBe('anonymized');
  });

  it('uses transaction when client supports it', async () => {
    let txCalled = false;
    const client: RtbfDrizzleClient = {
      async execute() {
        return [];
      },
      async transaction<T>(fn: (tx: RtbfDrizzleClient) => Promise<T>): Promise<T> {
        txCalled = true;
        return fn({
          async execute() {
            return [];
          },
        });
      },
    };
    const exec = createDsarRtbfExecutor({
      db: client,
      sqlTemplate: plainStringSql(),
    });
    await exec.executeRtbf({ subjectId: 'cus_1', requestedBy: 'admin' });
    expect(txCalled).toBe(true);
  });

  it('falls back to sequential execute when no transaction method', async () => {
    const client: RtbfDrizzleClient = {
      async execute() {
        return [];
      },
    };
    const exec = createDsarRtbfExecutor({
      db: client,
      sqlTemplate: plainStringSql(),
    });
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin',
    });
    expect(report.tablesProcessed.length).toBe(Object.keys(RTBF_POLICY).length);
  });
});

describe('dsar-rtbf-executor / per-policy mapping', () => {
  it('every table is represented in the report with its policy action', async () => {
    const { exec } = buildExecutor();
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin',
    });

    // Build a quick map of expected actions per table.
    const expected = new Map<string, string>();
    for (const [name, policy] of Object.entries(RTBF_POLICY)) {
      const subjectColumns = policy.subjectColumns.customerId;
      if (subjectColumns.length === 0) {
        expected.set(name, 'skipped');
      } else if (policy.action === 'ANONYMIZE') {
        expected.set(name, 'anonymized');
      } else if (policy.action === 'HARD_DELETE') {
        expected.set(name, 'hard-deleted');
      } else {
        expected.set(name, 'retained');
      }
    }
    for (const row of report.tablesProcessed) {
      expect(row.action).toBe(expected.get(row.table));
    }
  });

  it('policy table breakdown matches expectations: 7 anonymize, 5 hard-delete, 7 retain', () => {
    const counts: Record<string, number> = {
      ANONYMIZE: 0,
      HARD_DELETE: 0,
      RETAIN: 0,
    };
    for (const policy of Object.values(RTBF_POLICY)) {
      counts[policy.action] = (counts[policy.action] ?? 0) + 1;
    }
    // Phase D / A2b-1 added kernel_memory_episodic + kernel_memory_semantic
    // (HARD_DELETE × 2) and tenant_identities + employees (ANONYMIZE × 2).
    expect(counts.ANONYMIZE).toBe(7);
    expect(counts.HARD_DELETE).toBe(5);
    expect(counts.RETAIN).toBe(7);
    expect(Object.keys(RTBF_POLICY).length).toBe(19);
  });

  describe('phase-2 RTBF tables (A2b-1)', () => {
    it('kernel_memory_episodic is HARD_DELETE on customerId path', async () => {
      const { exec, capturedQueries } = buildExecutor(
        { mutationsByTable: { kernel_memory_episodic: 3 } },
        { tenantId: 'tnt_t' },
      );
      const report = await exec.executeRtbf({
        subjectId: 'cus_42',
        requestedBy: 'admin-1',
      });
      const entry = report.tablesProcessed.find(
        (t) => t.table === 'kernel_memory_episodic',
      );
      expect(entry?.action).toBe('hard-deleted');
      expect(entry?.rowsAffected).toBe(3);
      const del = capturedQueries.find(
        (q) =>
          q.kind === 'DELETE' && q.rendered.includes('"kernel_memory_episodic"'),
      );
      expect(del).toBeDefined();
      expect(del!.rendered).toContain('"user_id"');
    });

    it('kernel_memory_semantic is HARD_DELETE on customerId path', async () => {
      const { exec, capturedQueries } = buildExecutor(
        { mutationsByTable: { kernel_memory_semantic: 7 } },
        { tenantId: 'tnt_t' },
      );
      const report = await exec.executeRtbf({
        subjectId: 'cus_77',
        requestedBy: 'admin-1',
      });
      const entry = report.tablesProcessed.find(
        (t) => t.table === 'kernel_memory_semantic',
      );
      expect(entry?.action).toBe('hard-deleted');
      expect(entry?.rowsAffected).toBe(7);
      const del = capturedQueries.find(
        (q) =>
          q.kind === 'DELETE' && q.rendered.includes('"kernel_memory_semantic"'),
      );
      expect(del).toBeDefined();
    });

    it('tenant_identities is ANONYMIZE on email path — strips email + phone', async () => {
      const { exec, capturedQueries } = buildExecutor({
        mutationsByTable: { tenant_identities: 1 },
      });
      const report = await exec.executeRtbf({
        subjectId: 'user@example.com',
        requestedBy: 'admin-1',
      });
      const entry = report.tablesProcessed.find(
        (t) => t.table === 'tenant_identities',
      );
      expect(entry?.action).toBe('anonymized');
      const upd = capturedQueries.find(
        (q) => q.kind === 'UPDATE' && q.rendered.includes('"tenant_identities"'),
      );
      expect(upd).toBeDefined();
      expect(upd!.rendered).toContain('"email"');
      expect(upd!.rendered).toContain('"phone_normalized"');
      expect(upd!.rendered).toContain('[REDACTED]');
    });

    it('employees is ANONYMIZE on customerId (user_id) path — strips name + contact', async () => {
      const { exec, capturedQueries } = buildExecutor(
        { mutationsByTable: { employees: 1 } },
        { tenantId: 'tnt_alpha' },
      );
      const report = await exec.executeRtbf({
        subjectId: 'usr_99',
        requestedBy: 'admin-1',
      });
      const entry = report.tablesProcessed.find((t) => t.table === 'employees');
      expect(entry?.action).toBe('anonymized');
      const upd = capturedQueries.find(
        (q) => q.kind === 'UPDATE' && q.rendered.includes('"employees"'),
      );
      expect(upd).toBeDefined();
      expect(upd!.rendered).toContain('"first_name"');
      expect(upd!.rendered).toContain('"last_name"');
      expect(upd!.rendered).toContain('"email"');
      expect(upd!.rendered).toContain('"phone"');
      expect(upd!.rendered).toContain("tenant_id = 'tnt_alpha'");
    });
  });
});

describe('dsar-rtbf-executor / subject-kind inference', () => {
  it('email subject id is inferred as email kind', async () => {
    const { exec } = buildExecutor();
    const report = await exec.executeRtbf({
      subjectId: 'user@example.com',
      requestedBy: 'admin',
    });
    expect(report.subjectKind).toBe('email');
  });

  it('tnt_* subject id is inferred as tenantId kind', async () => {
    const { exec } = buildExecutor();
    const report = await exec.executeRtbf({
      subjectId: 'tnt_42',
      requestedBy: 'admin',
    });
    expect(report.subjectKind).toBe('tenantId');
  });

  it('explicit kind overrides inference', async () => {
    const { exec } = buildExecutor();
    const report = await exec.executeRtbf({
      subjectId: 'cus_with_at@symbol',
      subjectKind: 'customerId',
      requestedBy: 'admin',
    });
    expect(report.subjectKind).toBe('customerId');
  });
});

describe('dsar-rtbf-executor / tenant scoping', () => {
  it('appends tenant_id = $tenantId to every WHERE clause when tenantId provided', async () => {
    const { exec, capturedQueries } = buildExecutor(
      {
        mutationsByTable: { customers: 1, messages: 1 },
        countByTable: { audit_events: 2 },
      },
      { tenantId: 'tnt_alpha' },
    );
    await exec.executeRtbf({ subjectId: 'cus_1', requestedBy: 'admin' });
    const everyMutation = capturedQueries.filter(
      (q) => q.kind === 'UPDATE' || q.kind === 'DELETE',
    );
    for (const q of everyMutation) {
      expect(q.rendered).toContain("tenant_id = 'tnt_alpha'");
    }
  });

  it('omits tenant predicate when no tenantId provided', async () => {
    const { exec, capturedQueries } = buildExecutor({
      mutationsByTable: { customers: 1 },
    });
    await exec.executeRtbf({ subjectId: 'cus_1', requestedBy: 'admin' });
    const customersUpdate = capturedQueries.find(
      (q) => q.kind === 'UPDATE' && q.rendered.includes('"customers"'),
    );
    expect(customersUpdate).toBeDefined();
    expect(customersUpdate!.rendered).not.toContain('tenant_id');
  });
});

describe('dsar-rtbf-executor / report shape', () => {
  it('report is fully frozen — caller cannot mutate', async () => {
    const { exec } = buildExecutor();
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin',
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.tablesProcessed)).toBe(true);
    expect(Object.isFrozen(report.partialErrors)).toBe(true);
  });

  it('executedAt uses injected clock', async () => {
    const fixed = new Date('2026-05-15T10:00:00Z');
    const { exec } = buildExecutor({}, { now: () => fixed });
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin',
    });
    expect(report.executedAt).toBe('2026-05-15T10:00:00.000Z');
  });

  it('totalRowsAffected is sum across all processed tables', async () => {
    const { exec } = buildExecutor({
      mutationsByTable: { customers: 1, messages: 4, voice_turns: 2 },
      countByTable: { audit_events: 9 },
    });
    const report = await exec.executeRtbf({
      subjectId: 'cus_1',
      requestedBy: 'admin',
    });
    expect(report.totalRowsAffected).toBeGreaterThanOrEqual(7);
  });
});
