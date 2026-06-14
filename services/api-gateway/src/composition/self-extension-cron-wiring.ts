/**
 * self-extension-cron-wiring.ts — composes the FULL `SelfExtensionCronDeps`
 * from what the api-gateway composition root already has (a Drizzle db handle +
 * the service-role read wrapper), so `createSelfExtensionCron` is reachable from
 * `index.ts` WITHOUT reaching into service-registry internals or constructing a
 * live LLM client at the boot site.
 *
 * GOVERNANCE — propose-only, fail-CLOSED (mirrors the cron's own contract):
 *   - `fourEye` → the SINGLE owner four-eye enqueue path
 *     (`enqueueFourEyeRequest`). Terminal action is a PENDING approval a human
 *     reviews. Nothing auto-executes.
 *   - `selfBuild` → the propose-only self-build orchestrator
 *     (`createSelfBuildWiring`) whose `driveGapToProposal` stores a 'proposed'
 *     module only — never applies a migration.
 *   - `subMdRegistry.register()` → a FAIL-CLOSED throw. On the cron's
 *     propose-only path `register()` is NEVER called (only `list()` is, to
 *     de-dupe proposals). Wiring it as a thrower means that even if a future
 *     edit accidentally reached the runtime-apply path, it would error LOUDLY
 *     rather than silently activate a sub-MD. `list()` honest-degrades to `[]`.
 *   - `llmRouter.draftSubMdSpec` → a DETERMINISTIC, diagnosis-derived spec
 *     builder. The detector already hands us a fully-formed `suggestedPersona`,
 *     `suggestedScope`, `suggestedToolBelt` and `riskTier`; we project them onto
 *     the `SubMdSpec` shape. No network call, no literal model id, no fabricated
 *     LLM dependency — and the proposal is owner-reviewed in the four-eye inbox
 *     regardless. (A future wave may swap this for a live router behind its own
 *     flag; the cron contract is unchanged.)
 *
 * Immutable inputs; Pino-shape logger only (no console).
 */

import type { orchestrator } from '@borjie/central-intelligence';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
import { enqueueFourEyeRequest } from '../routes/owner/four-eye-approvals.hono.js';
import { createSelfBuildWiring } from './self-build/index.js';
import type { DatabaseClient } from './module-spawning/shared.js';
import type {
  SelfExtensionCronDeps,
  FourEyeEnqueuePort,
} from './self-extension-cron.js';

type SubMdRegistryPort = orchestrator.SubMdRegistryPort;
type SelfExtensionLLMRouterPort = orchestrator.SelfExtensionLLMRouterPort;
type SubMdSpec = orchestrator.SubMdSpec;

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * The four-eye port over the SINGLE `enqueueFourEyeRequest` enqueue path.
 * Honest-degrade: `enqueueFourEyeRequest` returns `null` (never throws) on a DB
 * fault, which we pass straight through (the cron treats `null` as "not
 * enqueued" and counts it without crashing).
 */
export function createFourEyeEnqueuePort(db: unknown): FourEyeEnqueuePort {
  return {
    async enqueue(args) {
      const enqueued = await enqueueFourEyeRequest(db, {
        tenantId: args.tenantId,
        requesterId: args.requesterId,
        actionType: args.actionType,
        payload: args.payload,
      });
      // enqueueFourEyeRequest returns { requestId, approvalToken } | null; the
      // cron only needs { requestId }. Strip the token (no need to widen the
      // cron's port surface).
      return enqueued ? { requestId: enqueued.requestId } : null;
    },
  };
}

/**
 * Fail-CLOSED sub-MD registry. `list()` honest-degrades to `[]` (the detector
 * uses it only to skip already-covered gaps, so an empty list is safe — at
 * worst it re-proposes, which the owner sees and rejects). `register()` is the
 * runtime-apply primitive the cron is FORBIDDEN from reaching: wiring it as a
 * thrower keeps the apply path UNMOUNTED and LOUD.
 */
export function createFailClosedSubMdRegistry(): SubMdRegistryPort {
  return {
    async list() {
      return [];
    },
    async register() {
      throw new Error(
        'self-extension-cron: sub-MD register() is UNMOUNTED on the propose-only path — runtime-apply requires the separate, owner-gated deploy wave.',
      );
    },
  };
}

/**
 * Deterministic, diagnosis-derived spec drafter. The detector already produced
 * a complete persona/scope/tool-belt/risk-tier; we project them onto the
 * `SubMdSpec`. Pure — no network, no model id. The proposal is owner-reviewed
 * in the four-eye inbox before anything is built.
 */
export function createDeterministicLlmRouter(): SelfExtensionLLMRouterPort {
  return {
    async draftSubMdSpec({ diagnosis }): Promise<SubMdSpec> {
      return Object.freeze({
        name: diagnosis.suggestedPersona.id,
        persona: diagnosis.suggestedPersona,
        scope: diagnosis.suggestedScope,
        toolBelt: diagnosis.suggestedToolBelt,
        // Always the safest tier; promotion to mutate / external-comm is an
        // explicit owner edit on the four-eye proposal (the kernel also clamps
        // any wider tier down to the diagnosis ceiling).
        riskTier: 'read',
        purpose: `Proposed sub-MD to handle the recurring pattern: ${diagnosis.pattern}`,
        successCriterion: 'owner-approval-required-before-any-action',
        schemaVersion: 1,
      });
    },
  };
}

export interface BuildSelfExtensionCronDepsArgs {
  /** Drizzle db handle (the self-build store + four-eye enqueue read/write). */
  readonly db: DatabaseClient;
  /**
   * Binds the service-role GUC around every cross-tenant / per-tenant read so
   * RLS FORCE holds for this out-of-band worker. The composition root injects
   * `(fn) => withServiceRoleContext(serviceRegistry.db, fn)`.
   */
  readonly withServiceRole: <T>(fn: (tx: DbLike) => Promise<T>) => Promise<T>;
  readonly logger?: PinoLikeLogger;
  /** Override the default-off `NODE_ENV==='test'` gate (tests pass true/false). */
  readonly enabled?: boolean;
  readonly intervalMs?: number;
}

/**
 * Compose the full `SelfExtensionCronDeps` from the db handle + service-role
 * wrapper. Construction is pure (no network, no env reads beyond the caller's
 * flag); every dep honest-degrades or fails-closed per the doc above.
 */
export function buildSelfExtensionCronDeps(
  args: BuildSelfExtensionCronDepsArgs,
): SelfExtensionCronDeps {
  const logger = args.logger ?? createPinoLikeLogger('self-extension-cron');
  const deps: SelfExtensionCronDeps = {
    withServiceRole: args.withServiceRole,
    logger,
    fourEye: createFourEyeEnqueuePort(args.db),
    selfBuild: createSelfBuildWiring({ db: args.db, logger }),
    subMdRegistry: createFailClosedSubMdRegistry(),
    llmRouter: createDeterministicLlmRouter(),
    proposerActor: 'self-extension-keystone',
    ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    ...(args.intervalMs !== undefined ? { intervalMs: args.intervalMs } : {}),
  };
  return deps;
}
