/**
 * Borjie ported-agent-stack composition helper (Batch 4).
 *
 * Structure inherited from a pre-fork lineage; evolved independently as
 * part of Borjie.
 *
 * Wires the 6-package agent stack onto `ServiceRegistry`:
 *
 *   - `@borjie/agent-runtime` (Claude Code parity): hooks +
 *     slash commands + sub-agents + skills + MCP host + memory +
 *     permission engine. Construction is async (file discovery)
 *     AND requires a project path + brain; exposed as a namespace
 *     so callers can invoke `agentRuntime.createAgentRuntime({
 *     projectPath, brain })` per request / per worker.
 *
 *   - `@borjie/mcp`: MCP protocol primitives + 3 transports +
 *     server/client/discovery + 5 domain servers + OAuth. Exposed
 *     as namespace; the existing `@borjie/mcp-server` slot
 *     (`registry.mcp`) is the deployable surface for the gateway's
 *     own MCP-server boot path. Per-tenant MCP servers are
 *     instantiated by their consumers via `createMCPServer({...})`.
 *
 *   - `@borjie/agent-orchestrator`: single + multi-agent patterns
 *     + state machine + cost optimization + durable execution +
 *     judge-jury. Requires a brain port (per-tenant, per-request);
 *     namespace-only exposure.
 *
 *   - `@borjie/open-coding-agent-patterns`: repo-map + minimal
 *     diff + sandbox + TDD loop + plan persistence + browser agent
 *     + trajectory. Requires a brain port; namespace-only exposure.
 *
 *   - `@borjie/openclaw-operating-model`: autonomy ladders L0-L5
 *     + 10 pre-shipped agent domains + per-tenant policy DSL + kill
 *     switches + AaaS endpoint store + CAO dashboards. Pre-wired
 *     via `createOpenClawOperatingModel()` with in-memory stores +
 *     auto-seeded shipped domains. Async factory, so we expose a
 *     Promise<OpenClawOperatingModel> slot (same pattern as
 *     `crossPortalBus`).
 *
 *   - `@borjie/agentic-os`: meta-synthesis layer (brain-first +
 *     goal engine + capability registry + constitutional preflight +
 *     observation loop + trust calibration + inter-agent negotiation
 *     + living KG). Requires 5+ concrete ports (brain, orchestrator,
 *     agentRegistry, constitution, kg); namespace-only exposure
 *     until those ports converge.
 */

import * as AgentRuntimeNs from '@borjie/agent-runtime';
import * as MCPNs from '@borjie/mcp';
import * as AgentOrchestratorNs from '@borjie/agent-orchestrator';
import * as OpenCodingAgentPatternsNs from '@borjie/open-coding-agent-patterns';
import * as OpenclawOperatingModelNs from '@borjie/openclaw-operating-model';
import * as AgenticOSNs from '@borjie/agentic-os';
import {
  createOpenClawOperatingModel,
  type OpenClawOperatingModel,
} from '@borjie/openclaw-operating-model';

export interface PortedAgentStackBundle {
  /** Claude-Code-parity agent runtime namespace (hooks + slash +
   *  sub-agents + skills + MCP host + memory + permissions). Async
   *  factory; instantiated by consumers per project / per worker. */
  readonly agentRuntime: typeof AgentRuntimeNs;
  /** Deep MCP namespace (protocol + transports + server + client +
   *  discovery + 5 domain servers + OAuth). Sister to the already-
   *  wired `@borjie/mcp-server` deployable surface. */
  readonly mcp: typeof MCPNs;
  /** Multi-pattern agent orchestrator namespace (single + multi +
   *  state machine + cost + durable + judge-jury). Brain-dependent. */
  readonly agentOrchestrator: typeof AgentOrchestratorNs;
  /** Open coding-agent patterns namespace (repo-map + minimal diff +
   *  sandbox + TDD + plan persistence + browser + trajectory).
   *  Brain-dependent. */
  readonly openCodingAgentPatterns: typeof OpenCodingAgentPatternsNs;
  /** OpenClaw operating-model namespace (autonomy ladders + 10 agent
   *  domains + policy DSL + kill-switch + AaaS + CAO). */
  readonly openclawOperatingModel: typeof OpenclawOperatingModelNs;
  /** Agentic OS namespace (brain-first synthesis layer). Requires 5+
   *  concrete ports; namespace-only exposure until those converge. */
  readonly agenticOS: typeof AgenticOSNs;

  /**
   * Pre-wired OpenClaw operating-model facade. In-memory stores +
   * auto-seeded shipped agent domains. The factory is async because
   * domain seeding awaits the registry; we expose it as a Promise so
   * the composition root stays synchronous (same pattern the C6
   * cross-portal bus uses for its lazy ioredis import).
   */
  readonly openclawInstance: Promise<OpenClawOperatingModel>;
}

/**
 * Build the ported-agent-stack bundle. Always non-null in both degraded
 * and live modes; the brain-dependent members are namespace-only so the
 * gateway boots without any LLM creds. The OpenClaw facade is the only
 * pre-wired stateful member — its async construction is hidden behind
 * a Promise slot.
 */
export function createPortedAgentStackBundle(): PortedAgentStackBundle {
  return Object.freeze({
    agentRuntime: AgentRuntimeNs,
    mcp: MCPNs,
    agentOrchestrator: AgentOrchestratorNs,
    openCodingAgentPatterns: OpenCodingAgentPatternsNs,
    openclawOperatingModel: OpenclawOperatingModelNs,
    agenticOS: AgenticOSNs,
    openclawInstance: createOpenClawOperatingModel({
      autoSeedShippedDomains: true,
    }),
  });
}
