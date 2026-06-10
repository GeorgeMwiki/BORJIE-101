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

import { createCapabilityCompositionEngine } from './capability-composition-engine.js';
import type {
  CapabilityCompositionEngine,
  CompositionModelPort,
  StepAuthorizationDecision,
} from './capability-composition-types.js';
import { decideAutoAuthorization } from '../services/auto-authorize-gate/index.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

const logger = createPinoLikeLogger('power-tools-wiring');

/** Default composition-planner model. Haiku-class — this is a fast pre-flight. */
const COMPOSITION_MODEL = 'claude-haiku-4-5';

// ─────────────────────────────────────────────────────────────────────
// Lazy registry singleton.
// ─────────────────────────────────────────────────────────────────────

let registrySingleton: PowerToolRegistry | null = null;

/**
 * Build (once) the power-tool registry with the adapters cleanly available
 * in gateway scope. Today NO real Drizzle/Inngest/isolated-vm adapter is
 * constructible here, so we pass `{}` — `buildPowerToolRegistry` binds the
 * safe in-memory schedule / blackboard / anchor-summary defaults and a
 * honest-degrading sandbox / cross_tenant. The registry never throws on a
 * missing adapter. Future wiring can thread real adapters through here.
 */
export function getPowerToolRegistry(): PowerToolRegistry {
  if (registrySingleton) return registrySingleton;
  registrySingleton = buildPowerToolRegistry({});
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
  const model = options.model ?? COMPOSITION_MODEL;
  return {
    async complete(args): Promise<string> {
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
