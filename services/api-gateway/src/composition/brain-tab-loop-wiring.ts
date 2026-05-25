/**
 * Brain↔Tab Loop wiring (Piece L).
 *
 * Composes the dispatch-router primitives at the api-gateway composition
 * root and wires:
 *   - A post-pipeline `captureHook` callable from anywhere a kernel turn
 *     finishes (BFF, voice-agent, doc-chat). Callers fire-and-forget so
 *     no user-reply latency is added.
 *   - In-process stores when DATABASE_URL is missing (dev mode); Drizzle-
 *     backed stores once the API ships its persistent adapters. The
 *     persistent adapters land as a follow-up so the wiring file stays
 *     dependency-light for build-time CI.
 *
 * Integration boundary with the kernel:
 *   - The kernel's `think()` returns a `BrainDecision`. Callers can wrap
 *     the call: `const dec = await kernel.think(req); fireCapture(dec, req);`
 *   - `fireCapture` MUST check `dec.kind === 'answer' || 'softened'` —
 *     refusals skip capture (inviolable rule).
 *
 * Until the persistent adapters land, the wiring uses the in-memory
 * stores from `@borjie/dispatch-router`. These are tenant-aware so
 * cross-tenant isolation holds even in dev.
 */

import {
  capture,
  createInMemoryAuditChainSink,
  createInMemoryCanonicalResolver,
  createInMemoryCaptureStore,
  createInMemoryEventLogStore,
  createInMemoryProposalStore,
  createIntentClassifier,
  createStubHandlerRegistry,
  dispatchToTabs,
  type CaptureInput,
  type CaptureResult,
  type InMemoryResolverStore,
} from '@borjie/dispatch-router';

export interface BrainTabLoopWiring {
  /**
   * Run capture + dispatch given a finished assistant turn. Caller
   * is expected to invoke this AFTER `kernel.think()` resolves, in a
   * fire-and-forget fashion (no user-reply latency).
   *
   * Refused decisions MUST be filtered out by the caller — the hook
   * throws on `decision_kind: 'refusal'` as a defence-in-depth check.
   */
  readonly captureHook: (input: CaptureInput) => Promise<CaptureResult>;

  /**
   * Resolver store — exposed so demo / dev paths can seed canonical
   * entities. Production wires the real Drizzle-backed resolver here.
   */
  readonly resolverStore: InMemoryResolverStore;

  /**
   * Snapshot accessors for ops/admin debug surfaces. Production
   * counterparts query Postgres directly.
   */
  readonly snapshots: {
    readonly captures: () => unknown;
    readonly proposals: () => unknown;
    readonly events: () => unknown;
    readonly chain: (tenant_id: string) => unknown;
  };
}

export interface BrainTabLoopWiringDeps {
  /**
   * Optional override of the proposal handler registry. The default is
   * the stub that logs invocations; production wires the real
   * `module-templates/*` handler registry once Piece B lands.
   */
  readonly handlerRegistry?: ReturnType<typeof createStubHandlerRegistry>;
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export function createBrainTabLoopWiring(
  deps: BrainTabLoopWiringDeps = {},
): BrainTabLoopWiring {
  const captureStore = createInMemoryCaptureStore();
  const proposalStore = createInMemoryProposalStore();
  const eventLog = createInMemoryEventLogStore();
  const auditSink = createInMemoryAuditChainSink();
  const { store: resolverStore, resolver } = createInMemoryCanonicalResolver();
  const classifier = createIntentClassifier();
  const handlerRegistry = deps.handlerRegistry ?? createStubHandlerRegistry();

  const captureHook = async (input: CaptureInput): Promise<CaptureResult> => {
    const result = await capture(input, {
      resolver,
      classifier,
      captureStore,
      eventLog,
      auditSink,
    });

    if (result.shouldDispatch) {
      await dispatchToTabs(
        {
          tenant_id: input.tenant_id,
          capture: result.capture,
          persona: input.persona,
          handlerRegistry,
        },
        { proposalStore, eventLog, auditSink },
      );
    }

    deps.logger?.info?.(
      {
        tenant_id: input.tenant_id,
        capture_id: result.capture.id,
        intent: result.capture.intent,
        capture_confidence: result.capture.capture_confidence,
        dispatched: result.shouldDispatch,
        deduplicated: result.deduplicated,
      },
      'brain_tab_loop.capture_completed',
    );

    return result;
  };

  return {
    captureHook,
    resolverStore,
    snapshots: {
      captures: () => captureStore.snapshot(),
      proposals: () => proposalStore.snapshot(),
      events: () => eventLog.snapshot(),
      chain: (tenant_id: string) => auditSink.snapshot(tenant_id),
    },
  };
}
