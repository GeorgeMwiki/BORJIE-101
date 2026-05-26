/**
 * Wave-3-int2 — Dispatch-router + ESTATE handler-set composition.
 *
 * Wires:
 *   - dispatch-router primitives (already provided by piece-l's
 *     brain-tab-loop-wiring)
 *   - the 5 ESTATE accept-proposal handlers
 *   - a tenant-override routing-rules loader (in-memory default; the
 *     Drizzle-backed loader is a follow-up so this file stays
 *     build-light at CI time)
 *   - the post-kernel.think capture hook
 *
 * Consumers attach `postThinkCaptureHook` to every `kernel.think()` call
 * site (today: the /think + /stream routes in `jarvis-router-factory`).
 * The hook is fire-and-forget so it adds zero latency to the user reply.
 *
 * The pattern mirrors `brain-tab-loop-wiring.ts` from piece-l but
 * upgrades to use the unified `runDispatchPipeline` (OTel-instrumented,
 * tenant-override aware, bulk-op safety enforced) and registers the
 * REAL handler registry instead of the stub.
 */

import {
  capture,
  createInMemoryAuditChainSink,
  createInMemoryCanonicalResolver,
  createInMemoryCaptureStore,
  createInMemoryEventLogStore,
  createInMemoryProposalStore,
  createInMemoryRoutingRulesLoader,
  createIntentClassifier,
  runDispatchPipeline,
  type AcceptHandlerRegistry,
  type AuditChainSink,
  type CaptureInput,
  type CaptureResult,
  type ConversationCaptureStore,
  type InMemoryResolverStore,
  type InMemoryRoutingRulesStore,
  type ModuleUpdateProposal,
  type ModuleUpdateProposalStore,
  type RoutingRulesLoader,
  type TabEventLogStore,
} from '@borjie/dispatch-router';
import {
  buildEstateHandlerSet,
  createModuleHandlerRegistry,
  type EstateHandlerDeps,
  type MiningHandlerDeps,
} from '@borjie/module-templates';

// ─── Public type ──────────────────────────────────────────────────────────

export interface DispatchRouterWiring {
  /**
   * Single post-kernel-turn hook. Pass every `kernel.think()` result here.
   *
   * Returns the proposals that were dispatched + the synthetic capture so
   * the caller can include the capture id in the assistant response (e.g.
   * "I drafted a lease application — see proposal X"). Refusals are
   * dropped by the underlying `capture()` step.
   */
  readonly postThinkCaptureHook: (
    input: CaptureInput,
  ) => Promise<{
    readonly capture: CaptureResult;
    readonly proposals: ReadonlyArray<ModuleUpdateProposal>;
  }>;

  /** Resolver-store accessor for dev seeding (e.g. owner-portal demo). */
  readonly resolverStore: InMemoryResolverStore;

  /** Routing-rules store accessor — used to add tenant-override rows. */
  readonly routingRulesStore: InMemoryRoutingRulesStore;

  /** Registry — exposed so tests + admin routes can introspect. */
  readonly handlerRegistry: AcceptHandlerRegistry;

  /** Persistence accessors — for ops debug surfaces. */
  readonly stores: {
    readonly captures: ConversationCaptureStore;
    readonly proposals: ModuleUpdateProposalStore;
    readonly events: TabEventLogStore;
    readonly auditSink: AuditChainSink;
  };
}

// ─── Deps ────────────────────────────────────────────────────────────────

export interface DispatchRouterWiringDeps {
  /** Estate handler ports. */
  readonly estate: EstateHandlerDeps;
  /**
   * Mining handler ports (closes TODO(#34) — replaces the BossNyumba
   * estate stubs). Optional so early-wave compositions can resolve
   * without them.
   */
  readonly mining?: MiningHandlerDeps;
  /** Optional override registry (e.g. for tests). */
  readonly handlerRegistry?: AcceptHandlerRegistry;
  /** Optional override routing-rules loader (Drizzle-backed in prod). */
  readonly routingRules?: RoutingRulesLoader;
  /**
   * Optional override of the proposal store — Drizzle-backed adapters
   * inject here. Defaults to the in-memory store so this wiring stays
   * dependency-light at CI time.
   */
  readonly stores?: {
    readonly captures?: ConversationCaptureStore;
    readonly proposals?: ModuleUpdateProposalStore;
    readonly events?: TabEventLogStore;
    readonly auditSink?: AuditChainSink;
  };
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
    readonly error?: (meta: object, msg: string) => void;
  };
}

// ─── Composition ──────────────────────────────────────────────────────────

/**
 * Build a fully wired dispatch-router. Used by the api-gateway composition
 * root. Returns a hook that `/think` + `/stream` call after `kernel.think()`.
 */
export function createDispatchRouterWiring(
  deps: DispatchRouterWiringDeps,
): DispatchRouterWiring {
  // 1. Persistence stores — default in-memory unless caller injects.
  const captureStore = deps.stores?.captures ?? createInMemoryCaptureStore();
  const proposalStore = deps.stores?.proposals ?? createInMemoryProposalStore();
  const eventLog = deps.stores?.events ?? createInMemoryEventLogStore();
  const auditSink = deps.stores?.auditSink ?? createInMemoryAuditChainSink();

  // 2. Resolver + intent classifier.
  const { store: resolverStore, resolver } = createInMemoryCanonicalResolver();
  const classifier = createIntentClassifier();

  // 3. Routing-rules loader — in-memory default.
  const { loader: routingRulesLoader, store: routingRulesStore } =
    createInMemoryRoutingRulesLoader();
  const routingRules = deps.routingRules ?? routingRulesLoader;

  // 4. Handler registry — real one with ESTATE + MINING adapters by
  //    default. MINING handlers close TODO(#34): the 3 BossNyumba estate
  //    stubs (open_maintenance_case, schedule_renewal_negotiation,
  //    bulk_mark_for_renewal_prep) are ported to mining-domain (asset_id,
  //    licence_id, etc.) and registered under the MINING module slug.
  const handlerRegistry =
    deps.handlerRegistry ??
    createModuleHandlerRegistry({
      estate: deps.estate,
      ...(deps.mining ? { mining: deps.mining } : {}),
    });

  // 5. Boot diagnostics — log which actions are registered.
  if (deps.logger?.info) {
    const registered = (handlerRegistry as { listRegistered?: () => unknown }).listRegistered;
    if (typeof registered === 'function') {
      deps.logger.info(
        { registered: registered() },
        'dispatch_router_wiring.registered_handlers',
      );
    }
  }

  // 6. The hook.
  const postThinkCaptureHook = async (
    input: CaptureInput,
  ): Promise<{
    readonly capture: CaptureResult;
    readonly proposals: ReadonlyArray<ModuleUpdateProposal>;
  }> => {
    try {
      const captureResult = await capture(input, {
        resolver,
        classifier,
        captureStore,
        eventLog,
        auditSink,
      });

      if (!captureResult.shouldDispatch) {
        return { capture: captureResult, proposals: [] };
      }

      const dispatchResult = await runDispatchPipeline(
        {
          tenant_id: input.tenant_id,
          capture: captureResult.capture,
          persona: input.persona,
        },
        {
          routingRules,
          handlerRegistry,
          proposalStore,
          eventLog,
          auditSink,
        },
      );

      deps.logger?.info?.(
        {
          tenant_id: input.tenant_id,
          capture_id: captureResult.capture.id,
          proposal_count: dispatchResult.proposals.length,
          matrix_size: dispatchResult.matrixSize,
          tenant_overrides: dispatchResult.tenantOverrideCount,
        },
        'dispatch_router.turn_complete',
      );

      return { capture: captureResult, proposals: dispatchResult.proposals };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.error?.(
        { tenant_id: input.tenant_id, error: message },
        'dispatch_router.turn_failed',
      );
      throw err;
    }
  };

  return {
    postThinkCaptureHook,
    resolverStore,
    routingRulesStore,
    handlerRegistry,
    stores: {
      captures: captureStore,
      proposals: proposalStore,
      events: eventLog,
      auditSink,
    },
  };
}

/**
 * Convenience: build a stub estate-handler-deps surface for tests +
 * dev composition where the real ports (LedgerService.post, etc.) are
 * not yet wired. Every port returns a stable fake id so the dispatcher's
 * accept_proposal path is exercisable end-to-end.
 *
 * The 3 BossNyumba estate stubs (openMaintenanceCase,
 * scheduleRenewalNegotiation, bulkMarkForRenewalPrep) have been
 * dropped — their mining-domain replacements live in
 * `createStubMiningHandlerDeps()` below. Closes TODO(#34).
 */
export function createStubEstateHandlerDeps(): EstateHandlerDeps {
  const auditChain = {
    async append() {
      return { id: `stub_audit_${Math.random().toString(36).slice(2, 8)}` };
    },
  };
  const notifications = {
    async publish() {
      /* no-op in dev */
    },
  };
  return {
    moduleId: 'ESTATE',
    createLeaseApplication: {
      coreEntity: {
        async findById() {
          return null;
        },
        async createPerson() {
          return { id: `stub_person_${Math.random().toString(36).slice(2, 8)}` };
        },
      },
      ledger: {
        async post() {
          return { id: `stub_ledger_${Math.random().toString(36).slice(2, 8)}` };
        },
      },
      applications: {
        async draftApplication() {
          return { id: `stub_app_${Math.random().toString(36).slice(2, 8)}` };
        },
      },
      auditChain,
      notifications,
    },
    postReceiptDraft: {
      ledger: {
        async draft() {
          return { id: `stub_ledger_draft_${Math.random().toString(36).slice(2, 8)}` };
        },
      },
      receipts: {
        async draft() {
          return { id: `stub_receipt_${Math.random().toString(36).slice(2, 8)}` };
        },
      },
      auditChain,
    },
  };
}

/**
 * Convenience: build a stub mining-handler-deps surface for tests +
 * dev composition. Stable-fake ports so the dispatcher's accept_proposal
 * path is exercisable end-to-end for the 3 mining actions:
 *   - schedule_licence_renewal
 *   - open_equipment_maintenance
 *   - bulk_mark_licences_for_renewal
 *
 * Real Drizzle-backed ports against `tasks` / `temporal_entities` /
 * `maintenance_events` swap in once the per-tenant DB connection is
 * wired through the composition root.
 */
export function createStubMiningHandlerDeps(): MiningHandlerDeps {
  const auditChain = {
    async append() {
      return { id: `stub_mining_audit_${Math.random().toString(36).slice(2, 8)}` };
    },
  };
  const notifications = {
    async publish() {
      /* no-op in dev */
    },
  };
  let counter = 0;
  const ids = {
    newId(prefix: string): string {
      counter += 1;
      return `stub_${prefix}_${counter}_${Math.random().toString(36).slice(2, 6)}`;
    },
  };
  return {
    moduleId: 'MINING',
    clock: {
      nowIso: () => new Date().toISOString(),
      todayIso: () => new Date().toISOString().slice(0, 10),
    },
    scheduleLicenceRenewal: {
      tasks: {
        async insert() {
          return { id: ids.newId('task') };
        },
      },
      temporalEntities: {
        async insert() {
          return { id: ids.newId('te') };
        },
      },
      auditChain,
      notifications,
      ids,
    },
    openEquipmentMaintenance: {
      maintenanceEvents: {
        async insert() {
          return { id: ids.newId('me') };
        },
      },
      tasks: {
        async insert() {
          return { id: ids.newId('task') };
        },
      },
      auditChain,
      notifications,
      ids,
    },
    bulkMarkLicencesForRenewal: {
      licenceTasks: {
        async bulkCreateRenewalTasks(args) {
          return {
            created: args.licenceIds.map((licenceId) => ({
              licenceId,
              taskId: ids.newId('task'),
            })),
            skipped: [],
          };
        },
      },
      auditChain,
    },
  };
}

// Re-export the handler set builder so dependants can grab it without
// importing both packages.
export { buildEstateHandlerSet, createModuleHandlerRegistry };
