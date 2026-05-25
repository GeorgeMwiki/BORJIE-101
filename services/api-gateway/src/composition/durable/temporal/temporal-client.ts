/**
 * temporal-client — shared scaffolding for the Temporal workflows
 * that govern SOX / regulator-grade actions (tenant eviction, owner
 * payouts, KRA MRI filing).
 *
 * Phase B (this PR) ships the workflow DEFINITIONS only. The actual
 * Temporal server deployment + workers come in Phase C. Until then
 * we expose a `MockTemporalClient` so callers can wire the
 * workflows into composition roots and tests can validate signature
 * conformance.
 *
 * Why Temporal for these particular workflows?
 *
 *   - Tenant eviction: multi-month process with legal notice
 *     periods, court dates, retry-with-court-order activities. The
 *     determinism guarantee (workflow code re-runs identically on
 *     replay) gives auditors a cryptographic chain-of-custody.
 *   - Owner payouts: exactly-once transfer-of-money semantics —
 *     Temporal's `signal` + activity idempotency tokens are the
 *     industry-standard pattern.
 *   - KRA MRI filing: multi-step regulatory submission with
 *     compensating actions on rejection. The TZ revenue authority
 *     spec mandates a tamper-evident audit trail (TRA Excise
 *     Regulations 2014 §22(4)) — Temporal's workflow history
 *     satisfies it.
 *
 * Phase B contract:
 *
 *   - Each workflow file exports a TYPED workflow signature and 1-2
 *     activity stubs. The activity bodies are deliberately
 *     placeholder — they delegate to a `delegateTo` callback so
 *     real activity implementations can be wired in Phase C without
 *     touching the workflow shape.
 *   - The `MockTemporalClient` satisfies the `TemporalClientLike`
 *     port; tests assert `start()` was called with the right args.
 *   - The real `@temporalio/client` is imported DYNAMICALLY (same
 *     pattern as Inngest) so the api-gateway boots in CI without
 *     the dep installed.
 *
 * Phase C follow-ups (Docs/TODO_BACKLOG.md):
 *   - Wire `createRealTemporalClient` against `@temporalio/client`
 *   - Provision the Temporal worker via `@temporalio/worker`
 *   - Move activity implementations from placeholder to real
 *     domain calls (eviction-court-gateway, GEPG, KRA MRI gateway)
 */

/** Narrow surface — only what the workflows use. */
export interface TemporalClientLike {
  /** Start a new workflow execution. Returns the run handle. */
  start(args: {
    readonly workflowId: string;
    readonly workflowType: string;
    readonly taskQueue: string;
    readonly args: ReadonlyArray<unknown>;
  }): Promise<TemporalRunHandle>;
  /** Send a signal to a running workflow. */
  signal(args: {
    readonly workflowId: string;
    readonly signalName: string;
    readonly args: ReadonlyArray<unknown>;
  }): Promise<void>;
  /** Query a running workflow's state. Returns the queried value. */
  query<T>(args: {
    readonly workflowId: string;
    readonly queryType: string;
    readonly args?: ReadonlyArray<unknown>;
  }): Promise<T>;
}

export interface TemporalRunHandle {
  readonly workflowId: string;
  readonly runId: string;
}

/**
 * In-process mock for tests. Records every call so assertions can
 * pin signature conformance without booting a Temporal server.
 *
 * The mock SHARES state across method calls — the same workflowId
 * receives signals + queries — so tests can exercise the full
 * happy-path flow.
 */
export interface MockTemporalState {
  readonly starts: ReadonlyArray<{
    workflowId: string;
    workflowType: string;
    taskQueue: string;
    args: ReadonlyArray<unknown>;
  }>;
  readonly signals: ReadonlyArray<{
    workflowId: string;
    signalName: string;
    args: ReadonlyArray<unknown>;
  }>;
  readonly queries: ReadonlyArray<{
    workflowId: string;
    queryType: string;
    args: ReadonlyArray<unknown>;
  }>;
}

export interface MockTemporalClient extends TemporalClientLike {
  readonly state: MockTemporalState;
  /** Override what `query()` returns for a given queryType. */
  setQueryResponse<T>(queryType: string, response: T): void;
}

export function createMockTemporalClient(): MockTemporalClient {
  const starts: Array<{
    workflowId: string;
    workflowType: string;
    taskQueue: string;
    args: ReadonlyArray<unknown>;
  }> = [];
  const signals: Array<{
    workflowId: string;
    signalName: string;
    args: ReadonlyArray<unknown>;
  }> = [];
  const queries: Array<{
    workflowId: string;
    queryType: string;
    args: ReadonlyArray<unknown>;
  }> = [];
  const queryResponses = new Map<string, unknown>();

  const state: MockTemporalState = {
    get starts() {
      return starts;
    },
    get signals() {
      return signals;
    },
    get queries() {
      return queries;
    },
  };

  return {
    state,
    setQueryResponse(queryType, response) {
      queryResponses.set(queryType, response);
    },
    async start(args) {
      starts.push({ ...args });
      return {
        workflowId: args.workflowId,
        runId: `mock-run-${starts.length}`,
      };
    },
    async signal(args) {
      signals.push({ ...args });
    },
    async query(args) {
      queries.push({
        workflowId: args.workflowId,
        queryType: args.queryType,
        args: args.args ?? [],
      });
      // Cast safely — queryResponses is typed `unknown` so callers
      // must assert when they read. The mock's setter is the only
      // path to set responses, and the test does the assert there.
      return (queryResponses.get(args.queryType) ?? null) as never;
    },
  };
}

/** Stable task-queue names. Workers in Phase C subscribe to these. */
export const TEMPORAL_TASK_QUEUES = {
  EVICTION: 'borjie-eviction',
  OWNER_PAYOUT: 'borjie-owner-payout',
  KRA_MRI_FILING: 'borjie-kra-mri-filing',
} as const;

/** Stable workflow-type identifiers. Pinned constants so the worker
 *  registry and the dispatcher agree on a single string. */
export const TEMPORAL_WORKFLOW_TYPES = {
  EVICTION: 'TenantEvictionWorkflow',
  OWNER_PAYOUT: 'OwnerPayoutWorkflow',
  KRA_MRI_FILING: 'KraMriFilingWorkflow',
} as const;
