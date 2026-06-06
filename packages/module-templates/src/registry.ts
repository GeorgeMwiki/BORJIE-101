/**
 * @borjie/module-templates/registry
 *
 * Cross-module `(module_template_id, action) → AcceptHandler` registry.
 *
 * Used by the dispatch-router's `AcceptHandlerRegistry` port. The
 * api-gateway composition root builds this registry once at startup with
 * real ports injected; tests build it with port fakes.
 *
 * Currently registers:
 *   - ESTATE   — 2 actions (`create_lease_application`, `post_receipt_draft`)
 *                GATED OFF: property-domain leftovers, only registered when
 *                `deps.estate` is explicitly supplied (legacy/property tests);
 *                the mining gateway no longer supplies them.
 *   - MINING   — 3 actions (`schedule_licence_renewal`,
 *                `open_equipment_maintenance`,
 *                `bulk_mark_licences_for_renewal`)
 *
 * Other modules (HR, FINANCE, etc.) attach handlers as their wave-3
 * follow-ups land — each new module exports its own
 * `build<Module>HandlerSet` similar to the estate/mining adapter files,
 * and `createModuleHandlerRegistry` merges them.
 *
 * The registry implementation is dispatch-router-compatible: it returns
 * an `AcceptHandlerRegistry` whose `.get(module, action)` is O(1).
 */

import type {
  AcceptHandler,
  AcceptHandlerRegistry,
} from '@borjie/dispatch-router';
import {
  buildEstateHandlerSet,
  ESTATE_ACTIONS,
  type BuildEstateHandlerSet,
  type EstateHandlerDeps,
} from './estate/accept-proposal-handlers.js';
import {
  buildMiningHandlerSet,
  MINING_ACTIONS,
  type BuildMiningHandlerSet,
  type MiningHandlerDeps,
} from './mining/accept-proposal-handlers.js';

// ─── Module → action → handler shape ──────────────────────────────────────

export interface RegisteredHandlerInfo {
  readonly moduleTemplateId: string;
  readonly action: string;
}

export interface ModuleHandlerRegistry extends AcceptHandlerRegistry {
  /** All registered (module, action) pairs — for diagnostics + tests. */
  readonly listRegistered: () => ReadonlyArray<RegisteredHandlerInfo>;
}

export interface CreateModuleHandlerRegistryDeps {
  /**
   * Estate template injections. OPTIONAL and gated OFF for the mining product:
   * the two ESTATE actions (`create_lease_application`, `post_receipt_draft`)
   * are property-domain leftovers with no mining-estate equivalent — a mining
   * estate uses licences (not leases) and routes receipts through the real
   * royalty/sales/ledger paths, all of which have their own real handlers.
   * When `estate` is omitted the estate actions are NOT registered, so the
   * brain can never dispatch a property action that would flip a proposal to
   * `failed`. Provide it only for legacy/property tests.
   */
  readonly estate?: EstateHandlerDeps;
  /**
   * Mining template injections. Optional so callers that have not yet
   * wired mining ports (e.g. early-wave tests) still resolve.
   */
  readonly mining?: MiningHandlerDeps;
  /** Optional caller-provided overrides — useful for tests. */
  readonly overrides?: Readonly<Record<string, AcceptHandler>>;
}

const ESTATE_MODULE_ID = 'ESTATE';
const MINING_MODULE_ID = 'MINING';

/**
 * Build a fully-wired dispatch-router handler registry across all
 * platform modules. Returns the registry + introspection accessors.
 */
export function createModuleHandlerRegistry(
  deps: CreateModuleHandlerRegistryDeps,
): ModuleHandlerRegistry {
  const handlers = new Map<string, AcceptHandler>();

  // ESTATE — property-domain leftovers (create_lease_application,
  // post_receipt_draft). GATED OFF for the mining product: registered ONLY
  // when estate deps are explicitly supplied (legacy/property tests). The
  // gateway composition no longer supplies them, so these actions never enter
  // the registry and the brain can never dispatch a property action that would
  // flip a proposal to `failed`.
  if (deps.estate) {
    const estateSet: BuildEstateHandlerSet = buildEstateHandlerSet(deps.estate);
    for (const action of ESTATE_ACTIONS) {
      const handler = estateSet[action];
      handlers.set(key(ESTATE_MODULE_ID, action), handler);
    }
  }

  // MINING — 3 actions (when wired).
  if (deps.mining) {
    const miningSet: BuildMiningHandlerSet = buildMiningHandlerSet(deps.mining);
    for (const action of MINING_ACTIONS) {
      const handler = miningSet[action];
      handlers.set(key(MINING_MODULE_ID, action), handler);
    }
  }

  // Future modules: HR, FLEET, FINANCE etc. land here as their adapters
  // ship. The registry is open for extension via the constructor pattern
  // so adding a new module is one line.

  // Apply overrides last so tests can replace any handler.
  if (deps.overrides) {
    for (const [k, h] of Object.entries(deps.overrides)) {
      handlers.set(k, h);
    }
  }

  return {
    get(moduleTemplateId, action) {
      return handlers.get(key(moduleTemplateId, action));
    },
    listInvocations() {
      // Registry itself does not track invocations — fake wrappers
      // in tests do that. Return an empty array so the optional
      // interface contract is satisfied.
      return [];
    },
    listRegistered() {
      return Array.from(handlers.keys()).map((k) => {
        const [moduleTemplateId, action] = k.split('::');
        return {
          moduleTemplateId: moduleTemplateId ?? '',
          action: action ?? '',
        };
      });
    },
  };
}

function key(moduleTemplateId: string, action: string): string {
  return `${moduleTemplateId}::${action}`;
}

/**
 * Tracking decorator — wraps a registry so tests can assert on every
 * handler call without overriding individual handlers.
 */
export function withInvocationTracking(
  inner: AcceptHandlerRegistry,
): AcceptHandlerRegistry & {
  readonly invocations: ReadonlyArray<{
    readonly moduleTemplateId: string;
    readonly action: string;
    readonly proposalId: string;
  }>;
} {
  const invocations: Array<{
    moduleTemplateId: string;
    action: string;
    proposalId: string;
  }> = [];
  return {
    get(moduleTemplateId, action) {
      const handler = inner.get(moduleTemplateId, action);
      if (!handler) return undefined;
      const wrapped: AcceptHandler = async (args) => {
        invocations.push({
          moduleTemplateId,
          action,
          proposalId: args.proposal.id,
        });
        return handler(args);
      };
      return wrapped;
    },
    get invocations() {
      return invocations;
    },
  };
}
