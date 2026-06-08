/**
 * Subagent brain resolver — adapts the per-tenant agent-stack brain into the
 * minimal `SubagentBrainPort` the executor consumes.
 *
 * The executor (md-subagent-executor.ts) is SDK-free by design (CLAUDE.md:
 * inject the existing brain port, never call SDKs). This resolver is the thin
 * shim that bridges the two:
 *
 *   - It pulls the per-tenant `agentStack` off the request-scoped service
 *     registry (`c.get('services').agentStack.getAgentStackForTenant`).
 *   - The agent-stack `brain` is the Anthropic-backed, budget-guarded
 *     orchestrator `BrainPort` (`call({ system, messages, maxTokens })`).
 *     Every call routes through the tenant's cost cap — the executor inherits
 *     that governance for free.
 *   - When no brain is configured (no ANTHROPIC_API_KEY → `brain: null`, or no
 *     registry on the context) it returns `null`. The route then honest-
 *     degrades: pending rows stay pending and the aggregate reports
 *     'unavailable' — output is NEVER fabricated.
 *
 * Kept beside the executor + repository as a service file (md-subagent-*) so
 * the route stays a thin loopback layer.
 */

import type { SubagentBrainPort } from './md-subagent-executor';

// Minimal structural shapes of the orchestrator brain — duck-typed so this
// resolver does not hard-depend on the agent-orchestrator package types and
// stays trivially testable with a stub.
interface OrchestratorBrainMessage {
  readonly role: 'user';
  readonly content: string;
}

interface OrchestratorBrainCall {
  readonly system: string;
  readonly messages: ReadonlyArray<OrchestratorBrainMessage>;
  readonly maxTokens: number;
  readonly temperature: number;
}

interface OrchestratorBrainResponse {
  readonly text?: string;
}

interface OrchestratorBrainLike {
  call(req: OrchestratorBrainCall): Promise<OrchestratorBrainResponse>;
}

interface AgentStackLike {
  readonly brain: OrchestratorBrainLike | null;
}

interface AgentStackBundleLike {
  getAgentStackForTenant(tenantId: string): AgentStackLike;
}

interface ServicesLike {
  readonly agentStack?: AgentStackBundleLike;
}

function isOrchestratorBrain(value: unknown): value is OrchestratorBrainLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { call?: unknown }).call === 'function'
  );
}

function hasAgentStack(value: unknown): value is ServicesLike {
  const stack = (value as ServicesLike | undefined)?.agentStack;
  return (
    typeof stack === 'object' &&
    stack !== null &&
    typeof stack.getAgentStackForTenant === 'function'
  );
}

/**
 * Resolve a `SubagentBrainPort` for a tenant from the request-scoped service
 * registry, or `null` when no brain is wired (caller honest-degrades).
 *
 * `services` is the value of `c.get('services')` — typed `unknown` because the
 * route handlers are written against `c: any`.
 */
export function resolveSubagentBrain(
  services: unknown,
  tenantId: string,
): SubagentBrainPort | null {
  if (!hasAgentStack(services)) return null;
  const stack = services.agentStack!.getAgentStackForTenant(tenantId);
  const brain = stack?.brain ?? null;
  if (!isOrchestratorBrain(brain)) return null;

  return {
    async run(req) {
      const response = await brain.call({
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.question }],
        maxTokens: req.maxTokens,
        temperature: 0.2,
      });
      return { text: response.text ?? '' };
    },
  };
}
