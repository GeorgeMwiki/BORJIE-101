/**
 * Power-tools + Capability-Composition Engine — gateway composition wiring.
 *
 * This module is the api-gateway-scope home for two things the brain's
 * Tier-2 self-architect needs:
 *
 *   1. A lazily-built `PowerToolRegistry` (the brain's own meta-capability
 *      inventory: handoff / sandbox / schedule / cross_tenant /
 *      self_modification / blackboard_stream / compose). The registry
 *      TOLERATES missing adapters — we pass only what is cleanly
 *      constructible in gateway scope and let the rest honest-degrade.
 *
 *   2. A `CompositionModelPort` adapter over the SAME circuit-breaker +
 *      OTel-wrapped `AnthropicMessagesClient` the kernel debate uses — we do
 *      NOT re-create a raw client.
 *
 *   3. `buildCapabilityCompositionEngine(...)` — assembles the engine from
 *      the registry + model port + the route's own `decideAutoAuthorization`
 *      governance gate.
 *
 * CI-INERTNESS: nothing here is called unless a REAL Anthropic client is
 * present. The composition root (`service-registry.ts`) only invokes
 * `buildCapabilityCompositionEngine` + `setCompositionEngine` when
 * `tryLoadBrainEnv → non-null`, mirroring the kernel-debate discipline.
 *
 * @module composition/power-tools-wiring
 */

import {
  powerTools,
  type ScopeContext,
  type AnthropicMessagesClient,
} from '@borjie/central-intelligence';

const { buildPowerToolRegistry } = powerTools;
type PowerToolRegistry = powerTools.PowerToolRegistry;
type ScheduleAdapter = powerTools.ScheduleAdapter;

import { createCapabilityCompositionEngine } from './capability-composition-engine.js';
import type {
  CapabilityCompositionEngine,
  CompositionModelPort,
  StepAuthorizationDecision,
} from './capability-composition-types.js';
import { decideAutoAuthorization } from '../services/auto-authorize-gate/index.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
import {
  isInngestEnabled,
  createInngestClient,
  type InngestClientLike,
} from './durable/inngest-client.js';
import { createInngestScheduleAdapter } from './power-tool-schedule-adapter.js';
import { resolveTierModel } from './model-tier-map.js';

const logger = createPinoLikeLogger('power-tools-wiring');

// ─────────────────────────────────────────────────────────────────────
// Lazy registry singleton.
// ─────────────────────────────────────────────────────────────────────

let registrySingleton: PowerToolRegistry | null = null;

/**
 * Wrap the ASYNC `createInngestClient` (it dynamic-imports the `inngest`
 * package) behind the SYNCHRONOUS `InngestClientLike.send` surface the
 * `ScheduleAdapter` needs. `getPowerToolRegistry` must stay synchronous (it is
 * called synchronously by the composition root), so we cannot `await` the
 * client at construction time. Instead the wrapper memoises the client promise
 * and resolves it lazily on the FIRST `send` — the moment a real
 * `power_tool.schedule` fires. If the client resolves `null` (dep absent /
 * construction failed) the send rejects, and the schedule adapter's own
 * rethrow degrades the tool to a `failed` result honestly.
 */
function createDeferredInngestClient(): InngestClientLike {
  let clientPromise: Promise<InngestClientLike | null> | null = null;
  const resolveClient = (): Promise<InngestClientLike | null> => {
    if (!clientPromise) {
      clientPromise = createInngestClient({ logger }).catch(() => null);
    }
    return clientPromise;
  };
  return {
    id: 'borjie-api-gateway',
    async send(event) {
      const client = await resolveClient();
      if (!client) {
        throw new Error(
          'inngest client unavailable — deferred power-tool call NOT persisted',
        );
      }
      return client.send(event);
    },
  };
}

/**
 * Build the durable schedule adapter when Inngest is enabled, else `null`
 * (registry keeps its in-memory default). NEVER throws on boot — any fault in
 * constructing the adapter falls back to `null`, so the registry build is
 * byte-for-byte the current in-memory default. This is the CI-inertness seam:
 * with no `INNGEST_EVENT_KEY`, `isInngestEnabled()` is false and we return
 * `null` immediately, never touching Inngest.
 */
function tryBuildScheduleAdapter(): ScheduleAdapter | null {
  try {
    if (!isInngestEnabled()) return null;
    return createInngestScheduleAdapter(createDeferredInngestClient(), logger);
  } catch (err) {
    logger.warn(
      {
        wiring: 'power-tools-wiring',
        err: err instanceof Error ? err.message : String(err),
      },
      'power-tools-wiring: schedule adapter construction failed — falling back to in-memory default',
    );
    return null;
  }
}

/**
 * Build (once) the power-tool registry with the adapters cleanly available in
 * gateway scope.
 *
 * `schedule`: when Inngest is enabled (`INNGEST_EVENT_KEY` set) we bind the
 * DURABLE Inngest-backed adapter — `power_tool.schedule` persists a
 * `POWER_TOOL_SCHEDULED_EVENT` that survives restarts. The matching firing
 * function (`inngest-functions/power-tool-scheduled-call.fn.ts`) sleeps until
 * `runAt` then re-enters the registry under the original tenant/tier/caller
 * with the hash-chained audit sink. When Inngest is disabled we pass NOTHING
 * for `schedule`, so `buildPowerToolRegistry` keeps the in-memory setTimeout
 * default — current behaviour, unchanged (CI-inert).
 *
 * DISPATCH SEAM (honest): the firing function is DEFINED + barrel-registered
 * but is NOT yet served, because the composition root never binds
 * `services.inngestRuntime` (the Inngest `serve()` path is unwired — see the
 * 503 in `inngest-webhook.router.ts`). So with Inngest enabled the schedule
 * call DOES durably persist (the event lands on Inngest), but it will only
 * FIRE once a serve runtime that injects {registry, db} into
 * `createPowerToolScheduledCallFunction` is wired. Until then this is a
 * durable-persist-with-documented-dispatch-seam, NOT a silent never-fires.
 *
 * `crossTenant`: passed NOTHING (null) by design — the `cross_tenant`
 * power-tool already honest-degrades to a `NOT_IMPLEMENTED` refusal when its
 * adapter is null. The contract requires a `{ count, mean, median, p10, p90 }`
 * shape, but the only real platform aggregate source — `peer_cohort_aggregates`
 * (packages/database/src/schemas/peer-cohort-benchmarks.schema.ts) — carries
 * only `percentileP25/P50/P75 + sampleSize`, with NO p10/p90/min band, and
 * admin-analytics carries no min/p90 either. A faithful k-anon adapter cannot
 * be sourced without a p90/min band; mapping P75→p90 would be a silent
 * correctness fudge on a platform-sovereign tool. So we honest-degrade rather
 * than fabricate the band.
 */
export function getPowerToolRegistry(): PowerToolRegistry {
  if (registrySingleton) return registrySingleton;
  const schedule = tryBuildScheduleAdapter();
  registrySingleton = buildPowerToolRegistry(
    schedule ? { schedule } : {},
  );
  return registrySingleton;
}

/** Test-only reset so suites can rebuild the registry between cases. */
export function __resetPowerToolRegistryForTests(): void {
  registrySingleton = null;
}

// ─────────────────────────────────────────────────────────────────────
// Model port — text-in / text-out over the wrapped Anthropic client.
// ─────────────────────────────────────────────────────────────────────

/**
 * Adapt a (circuit-breaker + OTel) wrapped `AnthropicMessagesClient` to the
 * engine's flat `CompositionModelPort`. We reuse the EXACT client the kernel
 * debate runs on — passed in by the composition root — and never construct a
 * parallel raw SDK client here.
 */
export function createAnthropicCompositionModelPort(
  client: AnthropicMessagesClient,
  options: { readonly model?: string } = {},
): CompositionModelPort {
  return {
    async complete(args): Promise<string> {
      // Cheap tier (Haiku-class) — the composition planner is a fast
      // pre-flight. Resolved PER-CALL via the composition-root tier map
      // (Intelligence-Elasticity: no pinned model id).
      const model = options.model ?? resolveTierModel('cheap');
      const response = await client.messages.create({
        model,
        max_tokens: args.maxTokens ?? 512,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      });
      let text = '';
      for (const block of response.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          text += block.text;
        }
      }
      return text;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Governance gate adapter — bind the route's fail-closed decider.
// ─────────────────────────────────────────────────────────────────────

/**
 * Wrap the route's `decideAutoAuthorization` into the engine's
 * `StepGovernanceGate` shape. The engine calls this for EVERY composed step;
 * a step authorizes only when the autonomy controller landed on `auto`.
 */
function governanceGate(args: {
  readonly verb: string;
  readonly rationale: string;
  readonly scope: ScopeContext;
}): StepAuthorizationDecision {
  const decision = decideAutoAuthorization(args.verb, args.rationale, args.scope);
  const out: StepAuthorizationDecision = {
    authorized: decision.authorized,
    reason: decision.reason,
  };
  return decision.autonomyDecision !== undefined
    ? { ...out, autonomyDecision: decision.autonomyDecision }
    : out;
}

// ─────────────────────────────────────────────────────────────────────
// Engine builder — the single entry the composition root calls.
// ─────────────────────────────────────────────────────────────────────

/**
 * Assemble the Capability-Composition Engine from a live (wrapped) Anthropic
 * client. ONLY called by the composition root when a real client is present
 * (CI-inert otherwise). Construction is pure — no network, no env reads.
 */
export function buildCapabilityCompositionEngine(
  client: AnthropicMessagesClient,
  options: { readonly model?: string } = {},
): CapabilityCompositionEngine {
  const modelPort = createAnthropicCompositionModelPort(client, options);
  return createCapabilityCompositionEngine({
    model: modelPort,
    registry: getPowerToolRegistry(),
    governanceGate,
    logger,
  });
}
