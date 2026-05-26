/**
 * hq-tool-port-bindings — composes the East-Africa identity / land-registry
 * connectors and the Temporal-backed workflow dispatchers for the
 * sovereign-tier HQ tools, then folds the result into a ready-to-merge
 * `HqToolRegistryWiring` via {@link createHqToolRegistry}.
 *
 * Why this file exists (ProdFix-1 wires 4 + 5):
 *
 *   The HQ tool registry already supports optional `nida`, `eardhi`,
 *   `evictionDispatcher`, `ownerPayoutDispatcher`, and `kraMriDispatcher`
 *   slots — every one of them was unbound in the gateway composition
 *   root, so `platform.verify_nida` / `platform.verify_eardhi_title` /
 *   `platform.evict_tenant` / `platform.payout_owner` /
 *   `platform.file_kra_mri` all surfaced their placeholder stubs
 *   (see {@link NOT_YET_WIRED_REASON}) even when the real adapters +
 *   workflow dispatchers were available.
 *
 *   This module:
 *     1. Reads `NIDA_GATEWAY_URL` + `EARDHI_GATEWAY_URL` env vars and
 *        constructs real `@borjie/connectors` adapters when set.
 *     2. Adapts each adapter's `ConnectorOutcome` shape to the kernel's
 *        narrow `{ ok | unverified/not-found | gateway-error }` port
 *        contracts.
 *     3. Lazily constructs the Temporal dispatcher bundle via
 *        {@link createTemporalDispatcherFromEnv} and threads each
 *        dispatcher through a thin lazy proxy so the synchronous
 *        composition root never has to await the bundle.
 *     4. Calls {@link createHqToolRegistry} with the resulting deps so
 *        downstream `createBrainKernelWiring({ hqToolRegistry })` picks
 *        them up automatically.
 *
 *   Defensive defaults: when an env var is unset we log a warning and
 *   leave the port unset; the registry then falls back to the
 *   `notYetWiredNidaPort` / `notYetWiredEardhiPort` stubs so the brain
 *   still shapes cleanly with a deterministic `gateway-error` refusal.
 *
 *   NIDA literals here are descriptive port-composition (env-var names,
 *   diagnostic flags, JSDoc) — not flowing logic. The connector adapter
 *   itself is allowlisted (packages/connectors/src/adapters/nida-adapter.ts).
 */
/* eslint-disable borjie/no-jurisdictional-literal -- NIDA port-composition wiring (env-var names + diagnostics, Case 3) */

import {
  createEardhiAdapter,
  createNidaAdapter,
  createNidaRealAdapter,
  type EardhiAdapter,
  type NidaAdapter,
  type NidaEnv,
  type NidaRealAdapter,
} from '@borjie/connectors';
import { hqTools, NOT_YET_WIRED_REASON } from '@borjie/central-intelligence';
import {
  createHqToolRegistry,
  type HqToolRegistryWiring,
  type HqCallerResolver,
} from './hq-tool-registry.js';
import {
  createTemporalDispatcherFromEnv,
  type TemporalDispatcherBundle,
} from './temporal-dispatcher-wiring.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface HqToolPortBindingsLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

export interface HqToolPortBindingsDeps {
  /** Optional Drizzle client — when present the registry composes B1's
   *  platform.* adapters via `buildHqDepsFromDb`. */
  readonly db: unknown | null;
  /** Caller-resolver bridging the in-flight admin request to the HQ
   *  registry's scope-aware tool execution. */
  readonly callerResolver: HqCallerResolver;
  /** Cross-portal publisher for killswitch + announcement fan-out. */
  readonly publishCrossPortalEvent?: unknown;
  /** Optional structured logger. */
  readonly logger?: HqToolPortBindingsLogger;
  /** Override the env source for tests. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface HqToolPortBindings {
  /** The fully-composed HQ tool registry — merge this into the kernel's
   *  tool registry via `createBrainKernelWiring({ hqToolRegistry })`. */
  readonly hqToolRegistry: HqToolRegistryWiring;
  /** Diagnostic — true when the real NIDA adapter was wired. */
  readonly nidaBound: boolean;
  /** Diagnostic — true when the real e-Ardhi adapter was wired. */
  readonly eardhiBound: boolean;
  /** Diagnostic — promise resolves to the Temporal bundle (or null when
   *  construction failed). Held so ops endpoints can inspect mock vs
   *  real-client state without re-constructing. */
  readonly temporalBundlePromise: Promise<TemporalDispatcherBundle | null>;
}

/**
 * Compose the NIDA / e-Ardhi / Temporal port bindings and seed an
 * HqToolRegistry. Synchronous — Temporal initialisation runs in the
 * background and dispatcher calls await the bundle lazily.
 */
export function createHqToolPortBindings(
  deps: HqToolPortBindingsDeps,
): HqToolPortBindings {
  const env = deps.env ?? process.env;
  const logger = deps.logger;

  // 1. NIDA — constructed only when NIDA_GATEWAY_URL is set; otherwise
  //    the registry falls back to its placeholder stub
  //    (see NOT_YET_WIRED_REASON.NIDA_PORT).
  const nidaPort = buildNidaPort(env, logger);
  const nidaBound = nidaPort !== null;

  // 2. e-Ardhi — same opt-in shape.
  const eardhiPort = buildEardhiPort(env, logger);
  const eardhiBound = eardhiPort !== null;

  // 3. Temporal dispatcher bundle — async construction. We hold the
  //    promise and wrap each dispatcher in a lazy proxy so the
  //    synchronous registry construction below can succeed before
  //    Temporal is reachable.
  const temporalBundlePromise = createTemporalDispatcherFromEnv({
    ...(logger ? { logger } : {}),
  }).catch((err) => {
    logger?.error?.(
      { err: err instanceof Error ? err.message : String(err) },
      'hq-tool-port-bindings: temporal-dispatcher construction failed',
    );
    return null;
  });

  const lazyEvictionDispatcher = createLazyEvictionDispatcher(
    temporalBundlePromise,
  );
  const lazyOwnerPayoutDispatcher = createLazyOwnerPayoutDispatcher(
    temporalBundlePromise,
  );
  const lazyKraMriDispatcher = createLazyKraMriDispatcher(
    temporalBundlePromise,
  );

  const hqToolRegistry = createHqToolRegistry({
    callerResolver: deps.callerResolver,
    db: (deps.db ?? null) as never,
    ...(deps.publishCrossPortalEvent
      ? { publishCrossPortalEvent: deps.publishCrossPortalEvent as never }
      : {}),
    ...(nidaPort ? { nida: nidaPort } : {}),
    ...(eardhiPort ? { eardhi: eardhiPort } : {}),
    evictionDispatcher: lazyEvictionDispatcher,
    ownerPayoutDispatcher: lazyOwnerPayoutDispatcher,
    kraMriDispatcher: lazyKraMriDispatcher,
    ...(logger
      ? { logger: { info: logger.info ?? undefined, warn: logger.warn ?? undefined } as never }
      : {}),
  });

  logger?.info?.(
    {
      wiring: 'hq-tool-port-bindings',
      nidaBound,
      eardhiBound,
      temporalLazyBindings: 3,
      hqToolCount: hqToolRegistry.toolNames.length,
    },
    'hq-tool-port-bindings: composed',
  );

  return {
    hqToolRegistry,
    nidaBound,
    eardhiBound,
    temporalBundlePromise,
  };
}

// ─────────────────────────────────────────────────────────────────────
// NIDA — adapter → kernel port adapter
// ─────────────────────────────────────────────────────────────────────

function buildNidaPort(
  env: NodeJS.ProcessEnv,
  logger: HqToolPortBindingsLogger | undefined,
): hqTools.SeedHqBrainToolsDeps['nida'] | null {
  const consumerKey = env.NIDA_CONSUMER_KEY?.trim();
  const consumerSecret = env.NIDA_CONSUMER_SECRET?.trim();
  const apiKey = env.NIDA_API_KEY?.trim();
  const realEnv = (env.NIDA_ENV?.trim() as NidaEnv | undefined) ?? 'sandbox';

  // Phase F.4 — prefer the production-grade real adapter when OAuth2
  // consumer credentials OR a NIDA_ENV explicit selector + apiKey are set.
  let realAdapter: NidaRealAdapter | null = null;
  if (consumerKey && consumerSecret) {
    realAdapter = createNidaRealAdapter({
      env: realEnv,
      auth: { kind: 'oauth2', consumerKey, consumerSecret },
    });
    logger?.info?.(
      { env: realEnv, authMode: 'oauth2' },
      'hq-tool-port-bindings: NIDA wired via REAL adapter (OAuth2)',
    );
  } else if (env.NIDA_ENV && apiKey) {
    realAdapter = createNidaRealAdapter({
      env: realEnv,
      auth: { kind: 'api-key', key: apiKey },
    });
    logger?.info?.(
      { env: realEnv, authMode: 'api-key' },
      'hq-tool-port-bindings: NIDA wired via REAL adapter (api-key)',
    );
  }

  if (realAdapter) {
    return adaptNidaToKernelPort(realAdapter);
  }

  const baseUrl = env.NIDA_GATEWAY_URL?.trim();
  if (!baseUrl) {
    logger?.warn?.(
      { reason: 'NIDA env vars not set', placeholder: NOT_YET_WIRED_REASON.NIDA_PORT },
      'hq-tool-port-bindings: NIDA not bound — falling back to placeholder stub',
    );
    return null;
  }
  const adapter: NidaAdapter = createNidaAdapter({
    baseUrl,
    ...(apiKey
      ? { auth: { kind: 'api-key', headerName: 'x-api-key', key: apiKey } }
      : {}),
  });
  return {
    async verifyIdentity(args) {
      const outcome = await adapter.verifyIdentity({
        nidaNumber: args.nidaNumber,
        biometricHash: args.biometricHash,
      });
      if (outcome.kind === 'ok') {
        return {
          kind: 'ok',
          verified: outcome.data.verified,
          name: outcome.data.name,
          dob: outcome.data.dob,
          photo_match_score: outcome.data.photo_match_score,
        };
      }
      if (outcome.kind === 'validation-failed') {
        return {
          kind: 'unverified',
          reason: outcome.issue,
        };
      }
      if (outcome.kind === 'upstream-error' && outcome.status === 404) {
        return {
          kind: 'unverified',
          reason: 'NIDA record not found',
        };
      }
      return {
        kind: 'gateway-error',
        message: formatConnectorFailure(outcome),
      };
    },
  };
}

/**
 * Adapt a NIDA real adapter to the kernel's narrow port contract.
 * Same outcome translation as the stub-aware path above.
 */
function adaptNidaToKernelPort(
  adapter: NidaRealAdapter,
): hqTools.SeedHqBrainToolsDeps['nida'] {
  return {
    async verifyIdentity(args) {
      const outcome = await adapter.verifyIdentity({
        nidaNumber: args.nidaNumber,
        biometricHash: args.biometricHash,
      });
      if (outcome.kind === 'ok') {
        return {
          kind: 'ok',
          verified: outcome.data.verified,
          name: outcome.data.name,
          dob: outcome.data.dob,
          photo_match_score: outcome.data.photo_match_score,
        };
      }
      if (outcome.kind === 'validation-failed') {
        return { kind: 'unverified', reason: outcome.issue };
      }
      if (outcome.kind === 'upstream-error' && outcome.status === 404) {
        return { kind: 'unverified', reason: 'NIDA record not found' };
      }
      return {
        kind: 'gateway-error',
        message: formatConnectorFailure(outcome),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// e-Ardhi — adapter → kernel port adapter
// ─────────────────────────────────────────────────────────────────────

function buildEardhiPort(
  env: NodeJS.ProcessEnv,
  logger: HqToolPortBindingsLogger | undefined,
): hqTools.SeedHqBrainToolsDeps['eardhi'] | null {
  const baseUrl = env.EARDHI_GATEWAY_URL?.trim();
  if (!baseUrl) {
    logger?.warn?.(
      { reason: 'EARDHI_GATEWAY_URL not set', placeholder: NOT_YET_WIRED_REASON.EARDHI_PORT },
      'hq-tool-port-bindings: e-Ardhi not bound — falling back to placeholder stub',
    );
    return null;
  }
  const apiKey = env.EARDHI_API_KEY?.trim();
  const adapter: EardhiAdapter = createEardhiAdapter({
    baseUrl,
    ...(apiKey
      ? { auth: { kind: 'api-key', headerName: 'x-api-key', key: apiKey } }
      : {}),
  });
  return {
    async verifyTitle(args) {
      const outcome = await adapter.verifyTitle({ titleNumber: args.titleNumber });
      if (outcome.kind === 'ok') {
        // The connector's Zod-inferred shape is structurally identical
        // to the port's readonly shape — only the variance of
        // `Array` vs `ReadonlyArray` differs. The values are not
        // mutated downstream, so a single readonly-widening cast at the
        // port boundary is safe.
        return {
          kind: 'ok',
          valid: outcome.data.valid,
          owner_name: outcome.data.owner_name,
          registered_at: outcome.data.registered_at,
          encumbrances: outcome.data.encumbrances as ReadonlyArray<{
            readonly kind: 'mortgage' | 'caveat' | 'lease' | 'court-order' | 'other';
            readonly noteRef: string;
            readonly registeredAt: string;
            readonly notes?: string;
          }>,
        };
      }
      if (outcome.kind === 'upstream-error' && outcome.status === 404) {
        return { kind: 'not-found' };
      }
      return {
        kind: 'gateway-error',
        message: formatConnectorFailure(outcome),
      };
    },
  };
}

function formatConnectorFailure(outcome: {
  readonly kind: string;
  readonly message?: string;
  readonly issue?: string;
  readonly reason?: string;
  readonly status?: number;
}): string {
  if (outcome.kind === 'upstream-error') {
    return `upstream-error status=${outcome.status ?? 'unknown'} message=${outcome.message ?? ''}`;
  }
  if (outcome.kind === 'transport-error') return `transport-error: ${outcome.message ?? ''}`;
  if (outcome.kind === 'rate-limited') return 'rate-limited by upstream gateway';
  if (outcome.kind === 'circuit-open') return 'circuit-open — too many recent failures';
  if (outcome.kind === 'unconfigured') return `unconfigured: ${outcome.reason ?? ''}`;
  return `connector outcome=${outcome.kind}`;
}

// ─────────────────────────────────────────────────────────────────────
// Temporal dispatchers — lazy proxies
// ─────────────────────────────────────────────────────────────────────
//
// Each port method awaits the bundle promise before delegating. When the
// promise rejects we surface a `temporal-not-ready` error so the HQ
// tool's executor surfaces a deterministic refusal (caller sees the
// same shape as the placeholder stub — see NOT_YET_WIRED_REASON).

function createLazyEvictionDispatcher(
  bundlePromise: Promise<TemporalDispatcherBundle | null>,
): hqTools.SeedHqBrainToolsDeps['evictionDispatcher'] {
  return {
    async start(args) {
      const bundle = await bundlePromise;
      if (!bundle) throw new Error('temporal-not-ready');
      return bundle.evictionDispatcher.start(args);
    },
    async withdraw(args) {
      const bundle = await bundlePromise;
      if (!bundle) throw new Error('temporal-not-ready');
      return bundle.evictionDispatcher.withdraw(args);
    },
  };
}

function createLazyOwnerPayoutDispatcher(
  bundlePromise: Promise<TemporalDispatcherBundle | null>,
): hqTools.SeedHqBrainToolsDeps['ownerPayoutDispatcher'] {
  return {
    async start(args) {
      const bundle = await bundlePromise;
      if (!bundle) throw new Error('temporal-not-ready');
      return bundle.ownerPayoutDispatcher.start(args);
    },
    async refund(args) {
      const bundle = await bundlePromise;
      if (!bundle) throw new Error('temporal-not-ready');
      return bundle.ownerPayoutDispatcher.refund(args);
    },
    async estimateUsdCents(args) {
      const bundle = await bundlePromise;
      if (!bundle) throw new Error('temporal-not-ready');
      return bundle.ownerPayoutDispatcher.estimateUsdCents(args);
    },
  };
}

function createLazyKraMriDispatcher(
  bundlePromise: Promise<TemporalDispatcherBundle | null>,
): hqTools.SeedHqBrainToolsDeps['kraMriDispatcher'] {
  return {
    async start(args) {
      const bundle = await bundlePromise;
      if (!bundle) throw new Error('temporal-not-ready');
      return bundle.kraMriDispatcher.start(args);
    },
    async requestRetraction(args) {
      const bundle = await bundlePromise;
      if (!bundle) throw new Error('temporal-not-ready');
      return bundle.kraMriDispatcher.requestRetraction(args);
    },
  };
}
