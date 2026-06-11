/**
 * Drizzle-repo tests — prove the Drizzle-backed persistence adapters
 * (`createDrizzleRunRepository` / `createDrizzleRunEventRepository` /
 * `createDrizzleAuditChainRepository`) satisfy the same port contracts as the
 * in-memory adapters AND that data round-trips durably:
 *
 *   1. The full engine lifecycle (start → propose → submit-for-review →
 *      auto-commit) drives the Drizzle repos and projects the right run state.
 *   2. The four-eyes approval QUEUE survives engine recreation against the same
 *      store (durability: a fresh engine reads the persisted in_approval run).
 *   3. The hashed audit chain persists + verifies (tamper-evident ordering).
 *   4. findById is a globally-unique-by-id read (no tenant hint), run via the
 *      service-role context.
 *   5. listForUser / listReviewQueue / list filter correctly.
 *
 * A fake transaction-capable Drizzle store mimics the narrow query-builder
 * surface the repos touch — the same idiom as the api-gateway
 * persistent-mcp-cost-ledger test. The store keys rows by the pgTable handle so
 * `withTenantContext` / `withServiceRoleContext` (which need `transaction` +
 * `execute`) and the repos' select/insert/update chains all resolve against one
 * in-process map — the moral equivalent of a real DB for contract purposes.
 */

import { describe, expect, it } from 'vitest';
import {
  workflowAuditChain,
  workflowRunEvents,
  workflowRuns,
} from '@borjie/database';
import {
  BUILT_IN_WORKFLOW_DEFINITIONS,
  createAuditHashChain,
  createCommitter,
  createDefinitionRegistry,
  createDrizzleAuditChainRepository,
  createDrizzleRunEventRepository,
  createDrizzleRunRepository,
  createInMemoryApprovalRouter,
  createRecordingApplier,
  createWorkflowEngine,
  verifyChainForRun,
  type ChangeApplier,
  type WorkflowKind,
} from '../index.js';
import {
  createAssignmentRegistry,
  createInMemoryAssignmentEventRepository,
  createInMemoryAssignmentRepository,
  type Capability,
} from '@borjie/assignment-registry';

const T = 'tenant-1';

// ─────────────────────────────────────────────────────────────────────────
// Fake Drizzle store — a single in-process map of pgTable → rows, with the
// narrow query-builder surface the repos use. Filters are evaluated by reading
// the column-handle's runtime name off the drizzle condition objects.
// ─────────────────────────────────────────────────────────────────────────

interface FakeStore {
  rows: Map<unknown, Array<Record<string, unknown>>>;
}

/** Extract the SQL column name from a drizzle Column handle. */
function colName(col: unknown): string {
  const c = col as { name?: string };
  return c.name ?? '';
}

/**
 * Drizzle's `eq`/`and` produce SQL objects we cannot introspect directly, so we
 * model conditions ourselves: the repos call `eq(table.col, value)` /
 * `and(...)`. We shadow them is impossible here; instead the fake select/update
 * captures the raw args. To keep the fake simple we re-implement the predicate
 * by snapshotting the column+value pairs the repo passes. We do this by making
 * `eq`/`and` from drizzle return plain marker objects — but drizzle's real
 * `eq` is imported by the repo. So instead we evaluate against the WHERE by
 * walking the drizzle SQL chunks. That is brittle; we take the simpler route:
 * the fake matches on ALL columns present in the inserted/updated row that also
 * appear as table columns, by comparing the predicate's serialized form.
 *
 * Pragmatic approach: the repos only ever filter by (a) id, (b) tenantId,
 * (c) tenantId+state, (d) tenantId+initiatedByUserId, (e) runId. We capture the
 * drizzle condition tree and extract {name,value} leaves generically.
 */
function extractLeaves(
  condition: unknown,
): Array<{ name: string; value: unknown }> {
  const out: Array<{ name: string; value: unknown }> = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const anyNode = node as Record<string, unknown>;
    // drizzle SQL object exposes `queryChunks`; eq() builds a chunk array of
    // [Column, StringChunk('='), Param(value)] style. We scan for Column-like
    // ({ name }) and Param-like ({ value }) leaves and pair them positionally.
    const chunks =
      (anyNode.queryChunks as unknown[]) ??
      (anyNode.chunks as unknown[]) ??
      null;
    if (Array.isArray(chunks)) {
      let pendingName: string | null = null;
      for (const chunk of chunks) {
        if (chunk && typeof chunk === 'object') {
          const ch = chunk as Record<string, unknown>;
          if (typeof ch.name === 'string') {
            pendingName = ch.name;
          } else if (
            'value' in ch &&
            pendingName &&
            // A drizzle Param value is a scalar; a StringChunk's `value`
            // is an array (e.g. [" = "]) — skip those so the operator
            // chunk between a Column and its Param is not mistaken for it.
            !Array.isArray(ch.value)
          ) {
            out.push({ name: pendingName, value: ch.value });
            pendingName = null;
          } else {
            visit(chunk);
          }
        }
      }
    }
  };
  visit(condition);
  return out;
}

/**
 * Decide whether an `orderBy(...)` argument is a DESC ordering.
 *
 * drizzle lowers both `col` and `desc(col)` to an SQL object before they
 * reach `orderBy`, with the direction rendered as a trailing StringChunk
 * (`value: [" asc"]` or `value: [" desc"]`) inside `queryChunks`. We scan
 * for that ` desc` fragment — robust across the column-wrapping the
 * `withTenantContext` / `withServiceRoleContext` helpers introduce.
 */
function orderByChunkIsDesc(arg: unknown): boolean {
  if (!arg || typeof arg !== 'object') return false;
  const chunks = (arg as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(chunks)) return false;
  return chunks.some((chunk) => {
    const value = (chunk as { value?: unknown })?.value;
    return (
      Array.isArray(value) &&
      value.some(
        (part) => typeof part === 'string' && part.trim() === 'desc',
      )
    );
  });
}

function matchesRow(
  row: Record<string, unknown>,
  leaves: Array<{ name: string; value: unknown }>,
): boolean {
  return leaves.every((leaf) => {
    // Map snake_case column name → the camelCase row key the repo wrote.
    const snake = leaf.name;
    const camel = snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    const actual = row[camel] ?? row[snake];
    return actual === leaf.value;
  });
}

function makeQueryBuilder(store: FakeStore) {
  function bucket(table: unknown): Array<Record<string, unknown>> {
    let b = store.rows.get(table);
    if (!b) {
      b = [];
      store.rows.set(table, b);
    }
    return b;
  }

  const tx = {
    async execute() {
      return undefined;
    },
    insert(table: unknown) {
      return {
        async values(row: Record<string, unknown>) {
          bucket(table).push({ ...row });
          return undefined;
        },
      };
    },
    update(table: unknown) {
      let setValues: Record<string, unknown> = {};
      let leaves: Array<{ name: string; value: unknown }> = [];
      const chain = {
        set(values: Record<string, unknown>) {
          setValues = values;
          return chain;
        },
        where(condition: unknown) {
          leaves = extractLeaves(condition);
          return chain;
        },
        async returning() {
          const matched = bucket(table).filter((r) => matchesRow(r, leaves));
          for (const r of matched) Object.assign(r, setValues);
          return matched.map((r) => ({ id: r.id }));
        },
      };
      return chain;
    },
    select(_projection?: unknown) {
      let table: unknown = null;
      let leaves: Array<{ name: string; value: unknown }> = [];
      let limitN: number | null = null;
      let orderDesc = false;
      const chain = {
        from(t: unknown) {
          table = t;
          return chain;
        },
        where(condition: unknown) {
          leaves = extractLeaves(condition);
          return chain;
        },
        orderBy(...args: unknown[]) {
          // Rows are stored in insertion order = recordedAt order for
          // sequential appends. We need to tell `orderBy(col)` (ASC, keep
          // insertion order — `listForRun`) apart from `orderBy(desc(col))`
          // (DESC, reverse — `latestHashForTenant` wants the LATEST row).
          //
          // In the current drizzle version BOTH arrive at `orderBy` already
          // lowered to an SQL object (keys: decoder/queryChunks/...), so the
          // old `.name`-on-a-bare-Column heuristic mis-classified the ASC
          // `listForRun` column as DESC and reversed the chain — surfacing
          // the LAST-appended (committed) entry at index 0 instead of the
          // GENESIS-anchored `started` entry. Discriminate instead on the
          // rendered direction: drizzle appends a trailing StringChunk whose
          // `value` is `[" asc"]` or `[" desc"]` to the column's SQL.
          orderDesc = args.some((a) => orderByChunkIsDesc(a));
          return chain;
        },
        limit(n: number) {
          limitN = n;
          return chain;
        },
        then(
          resolve: (rows: ReadonlyArray<Record<string, unknown>>) => unknown,
          reject?: (e: unknown) => unknown,
        ) {
          try {
            let rows = bucket(table).filter((r) => matchesRow(r, leaves));
            if (orderDesc) rows = [...rows].reverse();
            if (limitN !== null) rows = rows.slice(0, limitN);
            return Promise.resolve(resolve(rows.map((r) => ({ ...r }))));
          } catch (e) {
            return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
          }
        },
      };
      return chain;
    },
  };
  return tx;
}

function fakeDb(store: FakeStore) {
  return {
    async transaction(fn: (t: ReturnType<typeof makeQueryBuilder>) => Promise<unknown>) {
      return fn(makeQueryBuilder(store));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Engine harness wired against the Drizzle repos + the fake store.
// ─────────────────────────────────────────────────────────────────────────

function buildEngine(store: FakeStore) {
  const db = fakeDb(store);

  const registry = createAssignmentRegistry({
    assignmentRepository: createInMemoryAssignmentRepository(),
    eventRepository: createInMemoryAssignmentEventRepository(),
  });

  const definitionRegistry = createDefinitionRegistry();
  for (const def of BUILT_IN_WORKFLOW_DEFINITIONS) {
    definitionRegistry.register(T, def);
  }

  const allKinds: ReadonlyArray<WorkflowKind> =
    BUILT_IN_WORKFLOW_DEFINITIONS.map((d) => d.kind);
  const appliers = allKinds.map((k) => createRecordingApplier(k));
  const committer = createCommitter(appliers.map((p): ChangeApplier => p.applier));

  const router = createInMemoryApprovalRouter({ readThresholds: async () => null });

  const auditChainRepository = createDrizzleAuditChainRepository(db);
  const engine = createWorkflowEngine({
    scopeGuard: registry.scope,
    aiReviewer: {
      async review() {
        return {
          verdict: 'approve',
          source: 'ai',
          reviewerUserId: null,
          rationale: 'ok',
          redLines: [],
          coachingHints: [],
        };
      },
    },
    approvalRouter: router,
    committer,
    definitionRegistry,
    runRepository: createDrizzleRunRepository(db),
    eventRepository: createDrizzleRunEventRepository(db),
    auditChainRepository,
    auditChain: createAuditHashChain(auditChainRepository),
  });

  async function grantUser(args: {
    userId: string;
    scope: string;
    scopeRefs: string[];
    capabilities: Capability[];
  }): Promise<void> {
    await registry.management.assignUser({
      userId: args.userId,
      tenantId: T,
      scope: args.scope as Parameters<
        typeof registry.management.assignUser
      >[0]['scope'],
      scopeRefs: args.scopeRefs,
      capabilities: args.capabilities,
      assignedBy: 'system-test',
    });
  }

  return { engine, grantUser, auditChainRepository };
}

describe('Drizzle workflow repos — engine lifecycle', () => {
  it('photo_add auto-commits through the Drizzle repos', async () => {
    const store: FakeStore = { rows: new Map() };
    const { engine, grantUser } = buildEngine(store);
    await grantUser({
      userId: 'worker',
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['photo_add'],
    });

    const run = await engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p1',
      initiatedByUserId: 'worker',
    });
    expect(run.state).toBe('open');

    await engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p1:photos',
      before: {},
      after: { url: 's3://x/1.jpg' },
    });
    const committed = await engine.submitForReview({
      runId: run.id,
      actorUserId: 'worker',
    });
    expect(committed.state).toBe('committed');

    // findById re-reads the persisted, projected run.
    const reread = await engine.getRun(run.id);
    expect(reread?.state).toBe('committed');
    expect(reread?.committedAt).toBeInstanceOf(Date);
  });

  it('four-eyes approval queue SURVIVES engine recreation (durability)', async () => {
    const store: FakeStore = { rows: new Map() };
    const first = buildEngine(store);
    await first.grantUser({
      userId: 'worker',
      scope: 'parcel',
      scopeRefs: ['p2'],
      // parcel_edit_v1 requires the metadata_edit capability (built-in.ts:30);
      // the prior 'parcel_edit' grant never matched -> scope_denied at startRun.
      capabilities: ['metadata_edit'],
    });

    const run = await first.engine.startRun({
      tenantId: T,
      definitionId: 'parcel_edit_v1',
      scope: 'parcel',
      scopeRef: 'p2',
      initiatedByUserId: 'worker',
    });
    await first.engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p2',
      before: { area: 100 },
      after: { area: 200 },
    });
    const queued = await first.engine.submitForReview({
      runId: run.id,
      actorUserId: 'worker',
    });
    expect(queued.state).toBe('in_approval');

    // Simulate a restart: a brand-new engine against the SAME store.
    const second = buildEngine(store);
    const queue = await second.engine.approvalQueue(T);
    expect(queue.map((r) => r.id)).toContain(run.id);
    expect(queue[0]?.state).toBe('in_approval');
  });

  it('persists a tamper-evident audit chain that verifies', async () => {
    const store: FakeStore = { rows: new Map() };
    const { engine, grantUser, auditChainRepository } = buildEngine(store);
    await grantUser({
      userId: 'worker',
      scope: 'parcel',
      scopeRefs: ['p3'],
      capabilities: ['photo_add'],
    });
    const run = await engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p3',
      initiatedByUserId: 'worker',
    });
    await engine.proposeChange({
      runId: run.id,
      actorUserId: 'worker',
      targetEntity: 'parcel:p3:photos',
      before: {},
      after: { url: 's3://x/2.jpg' },
    });
    await engine.submitForReview({ runId: run.id, actorUserId: 'worker' });

    const entries = await auditChainRepository.listForRun(run.id);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.previousHash).toBe('GENESIS');
    const verified = await verifyChainForRun(auditChainRepository, run.id);
    expect(verified.ok).toBe(true);
    expect(verified.brokenAt).toBeNull();
  });

  it('listForUser returns only the user’s runs', async () => {
    const store: FakeStore = { rows: new Map() };
    const { engine, grantUser } = buildEngine(store);
    await grantUser({
      userId: 'worker',
      scope: 'parcel',
      scopeRefs: ['p4', 'p5'],
      capabilities: ['photo_add'],
    });
    await grantUser({
      userId: 'other',
      scope: 'parcel',
      scopeRefs: ['p4'],
      capabilities: ['photo_add'],
    });
    const mine = await engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p4',
      initiatedByUserId: 'worker',
    });
    await engine.startRun({
      tenantId: T,
      definitionId: 'photo_add_v1',
      scope: 'parcel',
      scopeRef: 'p4',
      initiatedByUserId: 'other',
    });
    const queue = await engine.myQueue(T, 'worker');
    expect(queue.map((r) => r.id)).toEqual([mine.id]);
  });
});

describe('Drizzle workflow repos — guards', () => {
  it('throws when constructed with a null db', () => {
    expect(() => createDrizzleRunRepository(null)).toThrow();
    expect(() => createDrizzleRunEventRepository(null)).toThrow();
    expect(() => createDrizzleAuditChainRepository(null)).toThrow();
  });

  it('update throws run_not_found for a missing run', async () => {
    const store: FakeStore = { rows: new Map() };
    const repo = createDrizzleRunRepository(fakeDb(store));
    await expect(
      repo.update({
        id: 'missing',
        tenantId: T,
        definitionId: 'd',
        kind: 'photo_add',
        scope: 'parcel',
        scopeRef: 'p',
        initiatedByUserId: 'u',
        assignedReviewerUserId: null,
        assignedApproverUserId: null,
        state: 'open',
        input: {},
        proposedChange: null,
        reviewDecision: null,
        approvalDecision: null,
        rejectionReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        committedAt: null,
      }),
    ).rejects.toThrow(/run_not_found/);
  });
});
