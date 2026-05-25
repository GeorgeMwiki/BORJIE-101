/**
 * temporal-dispatcher-wiring — factory that builds the per-tool
 * Temporal-workflow-dispatcher port adapters consumed by the 3 new HQ
 * tools (`platform.evict_tenant`, `platform.payout_owner`,
 * `platform.file_kra_mri`).
 *
 * Composition strategy
 * --------------------
 *
 *   1. `createTemporalDispatcherFromEnv()` is invoked at api-gateway
 *      boot. It returns a `TemporalDispatcherBundle` carrying one
 *      adapter per HQ tool plus the raw `TemporalClientLike` used to
 *      construct them.
 *   2. The factory chooses the underlying client as follows:
 *        - When `TEMPORAL_ADDRESS` env var is set AND the
 *          `@temporalio/client` package can be loaded, a real client is
 *          created.
 *        - Otherwise (missing env OR missing dep OR construction
 *          failure) the bundle falls back to `createMockTemporalClient`
 *          from B3 so the api-gateway boots cleanly in CI / local.
 *   3. The adapters call the existing `start*Workflow` dispatchers from
 *      `./durable/temporal/*-workflow.ts` — those functions already
 *      encapsulate the workflow id derivation, queue name and workflow
 *      type. The HQ-tool adapters add the `signal`-based rollback
 *      surface (`withdraw`, `refund`, `requestRetraction`) plus the
 *      USD-equivalent FX estimator the payout tool needs.
 *
 * Lazy import discipline
 * ----------------------
 *
 *   The real `@temporalio/client` is loaded with a dynamic `import()`
 *   so the api-gateway can build + test in CI without the dep installed
 *   yet (matches the Inngest pattern in `inngest-client.ts`). When the
 *   import fails the factory logs a warning and returns the mock-backed
 *   bundle.
 */

import { hqTools } from '@borjie/central-intelligence';

type EvictionWorkflowDispatcherPort = hqTools.EvictionWorkflowDispatcherPort;
type OwnerPayoutWorkflowDispatcherPort = hqTools.OwnerPayoutWorkflowDispatcherPort;
type KraMriFilingWorkflowDispatcherPort = hqTools.KraMriFilingWorkflowDispatcherPort;

import {
  type MockTemporalClient,
  type TemporalClientLike,
  createMockTemporalClient,
} from './durable/temporal/temporal-client.js';
import {
  evictionWorkflowId,
  startEvictionWorkflow,
} from './durable/temporal/eviction-workflow.js';
import {
  ownerPayoutWorkflowId,
  startOwnerPayoutWorkflow,
} from './durable/temporal/owner-payout-workflow.js';
import {
  kraMriFilingWorkflowId,
  startKraMriFilingWorkflow,
} from './durable/temporal/kra-mri-filing-workflow.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

/**
 * Bundle returned by the factory. The composition root threads each
 * dispatcher into the matching HQ-tool deps slot and (optionally) holds
 * onto `client` for diagnostic / shutdown work.
 */
export interface TemporalDispatcherBundle {
  readonly client: TemporalClientLike;
  readonly isMock: boolean;
  readonly evictionDispatcher: EvictionWorkflowDispatcherPort;
  readonly ownerPayoutDispatcher: OwnerPayoutWorkflowDispatcherPort;
  readonly kraMriDispatcher: KraMriFilingWorkflowDispatcherPort;
}

export interface TemporalLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

export interface CreateTemporalDispatcherOptions {
  /** Override the env-driven decision (tests). */
  readonly forceMock?: boolean;
  /** Override the Temporal address — defaults to `TEMPORAL_ADDRESS`. */
  readonly address?: string;
  /** Optional namespace — defaults to `TEMPORAL_NAMESPACE` or `default`. */
  readonly namespace?: string;
  /**
   * Optional FX estimator. The HQ tool's payout flow needs a
   * USD-equivalent in order to evaluate the cost-ceiling + extra-HIL
   * gates. When omitted, a conservative 1:1 USD-cents passthrough is
   * used — the real adapter wires this to the currency-preferences
   * service in production.
   */
  readonly fxEstimator?: (args: {
    readonly amount: number;
    readonly currency: string;
  }) => Promise<number>;
  readonly logger?: TemporalLogger;
  /**
   * Override the underlying client — useful in tests that want to
   * inspect raw `start()` invocations against a `MockTemporalClient`.
   */
  readonly clientOverride?: TemporalClientLike;
}

/**
 * Env-gate: returns true when both `TEMPORAL_ADDRESS` is set AND the
 * `@temporalio/client` package can plausibly be loaded. The gate runs
 * BEFORE the dynamic import so we don't pay the import cost on every
 * CI run.
 */
export function isTemporalEnabled(
  options: CreateTemporalDispatcherOptions = {},
): boolean {
  if (options.forceMock === true) return false;
  const addr = options.address ?? process.env.TEMPORAL_ADDRESS;
  return typeof addr === 'string' && addr.trim().length > 0;
}

/**
 * Construct the bundle. Always returns a usable bundle — falls back to
 * a `MockTemporalClient` when the real client is unavailable. Idempotent
 * on repeated calls but does NOT cache; the caller is responsible for
 * holding the result.
 */
export async function createTemporalDispatcherFromEnv(
  options: CreateTemporalDispatcherOptions = {},
): Promise<TemporalDispatcherBundle> {
  const logger = options.logger;
  let client: TemporalClientLike;
  let isMock: boolean;
  if (options.clientOverride) {
    client = options.clientOverride;
    isMock = isMockClient(options.clientOverride);
  } else if (!isTemporalEnabled(options)) {
    logger?.info?.(
      { reason: 'TEMPORAL_ADDRESS not set' },
      'temporal-dispatcher: falling back to MockTemporalClient',
    );
    client = createMockTemporalClient();
    isMock = true;
  } else {
    const real = await tryLoadRealClient(options, logger);
    if (real) {
      client = real;
      isMock = false;
      logger?.info?.(
        { address: options.address ?? process.env.TEMPORAL_ADDRESS },
        'temporal-dispatcher: real Temporal client connected',
      );
    } else {
      client = createMockTemporalClient();
      isMock = true;
    }
  }

  const fx =
    options.fxEstimator ??
    (async ({ amount }: { readonly amount: number; readonly currency: string }) =>
      amount);

  return {
    client,
    isMock,
    evictionDispatcher: buildEvictionDispatcher(client),
    ownerPayoutDispatcher: buildOwnerPayoutDispatcher(client, fx),
    kraMriDispatcher: buildKraMriDispatcher(client),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal — dispatcher builders
// ─────────────────────────────────────────────────────────────────────

function buildEvictionDispatcher(
  client: TemporalClientLike,
): EvictionWorkflowDispatcherPort {
  return {
    async start(args) {
      const handle = await startEvictionWorkflow({
        client,
        input: {
          tenantId: args.tenantId,
          leaseId: args.leaseId,
          breachKind: args.breachKind,
          initiatedByUserId: args.initiatedByUserId,
          // `evictionDate` + `courtRef` are carried in the HQ-tool input
          // for audit purposes; B3's workflow signature doesn't accept
          // them today (statutory days drive the timer). We forward
          // them as part of the workflow args anyway so the worker can
          // attach them to the activity payloads when it lands in C.
        },
      });
      return { workflowId: handle.workflowId, runId: handle.runId };
    },
    async withdraw(args) {
      await client.signal({
        workflowId: args.workflowId,
        signalName: 'withdrawEviction',
        args: [{ reason: args.reason }],
      });
    },
  };
}

function buildOwnerPayoutDispatcher(
  client: TemporalClientLike,
  fx: NonNullable<CreateTemporalDispatcherOptions['fxEstimator']>,
): OwnerPayoutWorkflowDispatcherPort {
  return {
    async start(args) {
      const handle = await startOwnerPayoutWorkflow({
        client,
        input: {
          tenantId: args.tenantId,
          ownerId: args.ownerId,
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
          initiatedByUserId: args.initiatedByUserId,
          currency: args.currency,
          // amount + bankAccount + idempotencyKey ride along inside the
          // workflow input args array; B3's body recomputes settlement
          // server-side but the HQ-tool-supplied values are persisted
          // in the workflow's start-event for audit.
        },
      });
      return { workflowId: handle.workflowId, runId: handle.runId };
    },
    async refund(args) {
      await client.signal({
        workflowId: args.workflowId,
        signalName: 'refundPayout',
        args: [{ reason: args.reason }],
      });
    },
    estimateUsdCents: fx,
  };
}

function buildKraMriDispatcher(
  client: TemporalClientLike,
): KraMriFilingWorkflowDispatcherPort {
  return {
    async start(args) {
      const handle = await startKraMriFilingWorkflow({
        client,
        input: {
          tenantId: args.tenantId,
          period: args.taxPeriodMonth,
          initiatedByUserId: args.initiatedByUserId,
          entityTin: args.returnPayload.entityTin,
        },
      });
      return { workflowId: handle.workflowId, runId: handle.runId };
    },
    async requestRetraction(args) {
      await client.signal({
        workflowId: args.workflowId,
        signalName: 'requestRetraction',
        args: [{ reason: args.reason }],
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Real-client loader — lazy, defensive
// ─────────────────────────────────────────────────────────────────────

/**
 * Narrow shape of the `@temporalio/client` connection + client we use.
 * We avoid importing the real types so typecheck stays clean when the
 * dep is absent.
 */
interface RealTemporalClientModule {
  readonly Connection?: {
    connect: (args: {
      readonly address: string;
    }) => Promise<{ readonly connection: unknown }>;
  };
  readonly Client?: new (cfg: {
    readonly connection?: unknown;
    readonly namespace?: string;
  }) => RealTemporalClient;
}

interface RealTemporalClient {
  readonly workflow: {
    start(workflowType: string, opts: {
      readonly taskQueue: string;
      readonly workflowId: string;
      readonly args: ReadonlyArray<unknown>;
    }): Promise<{
      readonly workflowId: string;
      readonly firstExecutionRunId: string;
      signal?: (signalName: string, ...args: unknown[]) => Promise<void>;
    }>;
    getHandle(workflowId: string): {
      signal(signalName: string, ...args: unknown[]): Promise<void>;
      query<T>(queryType: string, ...args: unknown[]): Promise<T>;
    };
  };
}

async function tryLoadRealClient(
  options: CreateTemporalDispatcherOptions,
  logger: TemporalLogger | undefined,
): Promise<TemporalClientLike | null> {
  try {
    // Dynamic import via string indirection so TS does not attempt to
    // type-resolve `@temporalio/client` at typecheck time. Matches the
    // pattern in `inngest-client.ts`.
    const moduleName = '@temporalio/client';
    const mod = (await import(/* @vite-ignore */ moduleName).catch(
      () => null,
    )) as RealTemporalClientModule | null;
    if (
      !mod ||
      typeof mod.Connection?.connect !== 'function' ||
      typeof mod.Client !== 'function'
    ) {
      logger?.warn?.(
        { reason: '@temporalio/client not installed' },
        'temporal-dispatcher: falling back to MockTemporalClient',
      );
      return null;
    }
    // TEMPORAL_ADDRESS / TEMPORAL_NAMESPACE MUST be set in production;
    // a silent `localhost:7233` default in prod would route real workflow
    // dispatches at a non-existent worker.
    const isProd = process.env.NODE_ENV === 'production';
    const envAddress = process.env.TEMPORAL_ADDRESS?.trim();
    if (isProd && !options.address && !envAddress) {
      throw new Error(
        'TEMPORAL_ADDRESS must be set in production (no silent "localhost:7233" default)',
      );
    }
    const address = options.address ?? envAddress ?? 'localhost:7233';
    const envNamespace = process.env.TEMPORAL_NAMESPACE?.trim();
    if (isProd && !options.namespace && !envNamespace) {
      throw new Error(
        'TEMPORAL_NAMESPACE must be set in production (no silent "default" namespace)',
      );
    }
    const namespace =
      options.namespace ?? envNamespace ?? 'default';
    const { connection } = await mod.Connection.connect({ address });
    const realClient = new mod.Client({ connection, namespace });
    return adaptRealClient(realClient);
  } catch (err) {
    logger?.error?.(
      {
        err: err instanceof Error ? err.message : String(err),
      },
      'temporal-dispatcher: real client construction failed — falling back',
    );
    return null;
  }
}

/**
 * Adapt the real `@temporalio/client` Client to our narrow
 * `TemporalClientLike` port. The real client's `workflow.start` returns
 * a handle with `firstExecutionRunId`; we translate to our `runId`.
 */
function adaptRealClient(real: RealTemporalClient): TemporalClientLike {
  return {
    async start(args) {
      const handle = await real.workflow.start(args.workflowType, {
        taskQueue: args.taskQueue,
        workflowId: args.workflowId,
        args: args.args,
      });
      return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
      };
    },
    async signal(args) {
      const handle = real.workflow.getHandle(args.workflowId);
      await handle.signal(args.signalName, ...args.args);
    },
    async query(args) {
      const handle = real.workflow.getHandle(args.workflowId);
      return handle.query(args.queryType, ...(args.args ?? []));
    },
  };
}

function isMockClient(client: TemporalClientLike): boolean {
  // The mock exposes a `state` property; the real client does not.
  return typeof (client as MockTemporalClient).state === 'object';
}

// ─────────────────────────────────────────────────────────────────────
// Re-exports for callers that only import this module
// ─────────────────────────────────────────────────────────────────────

export {
  evictionWorkflowId,
  ownerPayoutWorkflowId,
  kraMriFilingWorkflowId,
};
