/**
 * @borjie/agentic-os — public barrel + composition factory.
 *
 * The meta-synthesis layer. `createAgenticOS` is the single composition
 * root that wires every duck-typed port for in-flight P55..P61 packages
 * into a coherent brain-first, goal-directed, constitutionally-guarded,
 * observation-and-trust-calibrated runtime.
 */

export * from './types.js';
export * from './brain-first-gateway/index.js';
export * from './goal-engine/index.js';
export * from './capability-registry/index.js';
export * from './constitutional-preflight/index.js';
export * from './observation-loop/index.js';
export * from './trust-calibration/index.js';
export * from './inter-agent-negotiation/index.js';
export * from './living-kg/index.js';

import type {
  AgentMatch,
  AgentRegistryPort,
  AudioPort,
  BrainPort,
  CapabilityRegistryPort,
  ConstitutionPort,
  GoalResult,
  KGPort,
  MCPPort,
  ObservationStorePort,
  OpenClawPort,
  RequestEnvelope,
  RoutingDecision,
  TrustStorePort,
  WorkflowEnginePort,
  Goal,
  SubGoal,
} from './types.js';

import { routeRequest } from './brain-first-gateway/index.js';
import { createInMemoryCapabilityRegistry } from './capability-registry/index.js';
import {
  composeGoal,
  decomposeIntoSubgoals,
  executeGoal,
  parseIntent,
  type OrchestratorPort,
} from './goal-engine/index.js';
import { createObservationLoop } from './observation-loop/index.js';
import { createTrustCalibrator } from './trust-calibration/index.js';

// ============================================================================
// Composition factory
// ============================================================================

export interface CreateAgenticOSArgs {
  /** The brain — duck-typed port over agent-orchestrator BrainPort. Required. */
  readonly brain: BrainPort;
  /** The orchestrator that runs subgoals. Required. */
  readonly orchestrator: OrchestratorPort;
  /** The agent registry (duck-typed over openclaw AgentRegistry). Required. */
  readonly agentRegistry: AgentRegistryPort;
  /** Optional pre-existing capability registry; otherwise an in-memory one is created. */
  readonly capabilityRegistry?: CapabilityRegistryPort;
  /** Constitution port (duck-typed over autonomy-governance). Required. */
  readonly constitution: ConstitutionPort;
  /** Knowledge graph port (duck-typed over knowledge-graph). Required. */
  readonly kg: KGPort;
  /** Pre-existing observation store; otherwise a new in-memory loop is created. */
  readonly observations?: ObservationStorePort;
  /** Pre-existing trust store; otherwise a new in-memory calibrator is created. */
  readonly trustStore?: TrustStorePort;
  /** Workflow engine port for escalations. Optional but recommended. */
  readonly workflowEngine?: WorkflowEnginePort;
  /** MCP host port (duck-typed over mcp). Optional. */
  readonly mcp?: MCPPort;
  /** Audio port (duck-typed over audio-capture). Optional — only voice channel needs it. */
  readonly audio?: AudioPort;
  /** OpenClaw operating-model port for autonomy ceilings. Optional. */
  readonly openClawModel?: OpenClawPort;
  /** Brain timeout (ms) used by the gateway. Default 800. */
  readonly brainTimeoutMs?: number;
}

export interface AgenticOS {
  readonly brain: BrainPort;
  readonly orchestrator: OrchestratorPort;
  readonly agentRegistry: AgentRegistryPort;
  readonly capabilityRegistry: CapabilityRegistryPort;
  readonly constitution: ConstitutionPort;
  readonly kg: KGPort;
  readonly observations: ObservationStorePort;
  readonly trustStore: TrustStorePort;
  readonly workflowEngine?: WorkflowEnginePort;
  readonly mcp?: MCPPort;
  readonly audio?: AudioPort;
  readonly openClawModel?: OpenClawPort;
  /** End-to-end request handler: brain-first route → goal → execute. */
  handleRequest(envelope: RequestEnvelope): Promise<HandleRequestResult>;
  /** Lower-level brain-first route only. */
  route(envelope: RequestEnvelope): Promise<RoutingDecision>;
}

export interface HandleRequestResult {
  readonly routingDecision: RoutingDecision;
  readonly goal: Goal | null;
  readonly subGoals: ReadonlyArray<SubGoal>;
  readonly goalResult: GoalResult | null;
  readonly reason?: string;
}

/**
 * Composition root. Returns the unified runtime that brain-first routes,
 * composes goals, runs the orchestrator, and records observations.
 *
 * Every port is duck-typed so this factory accepts adapters wrapping
 * concrete in-flight packages without importing them.
 */
export function createAgenticOS(args: CreateAgenticOSArgs): AgenticOS {
  const capabilityRegistry =
    args.capabilityRegistry ?? createInMemoryCapabilityRegistry();
  const observations = args.observations ?? createObservationLoop();
  const trustStore = args.trustStore ?? createTrustCalibrator();
  const brainTimeoutMs = args.brainTimeoutMs;

  async function route(envelope: RequestEnvelope): Promise<RoutingDecision> {
    return await routeRequest({
      envelope,
      brain: args.brain,
      agentRegistry: args.agentRegistry,
      capabilities: capabilityRegistry,
      trustStore,
      ...(args.openClawModel ? { openClaw: args.openClawModel } : {}),
      ...(brainTimeoutMs !== undefined ? { brainTimeoutMs } : {}),
    });
  }

  async function handleRequest(
    envelope: RequestEnvelope,
  ): Promise<HandleRequestResult> {
    const routingDecision = await route(envelope);
    if (!routingDecision.chosenAgent) {
      return {
        routingDecision,
        goal: null,
        subGoals: [],
        goalResult: null,
        reason: routingDecision.rationale,
      };
    }

    const intent = await parseIntent({ envelope, brain: args.brain });
    const goal = await composeGoal({ envelope, intent, brain: args.brain });
    const candidates: ReadonlyArray<AgentMatch> = [routingDecision.chosenAgent];
    const subGoals = await decomposeIntoSubgoals({
      goal,
      brain: args.brain,
      capabilities: capabilityRegistry,
      candidates,
    });

    const goalResult = await executeGoal({
      goal,
      subGoals,
      orchestrator: args.orchestrator,
      observations,
    });

    return {
      routingDecision,
      goal,
      subGoals,
      goalResult,
    };
  }

  return Object.freeze<AgenticOS>({
    brain: args.brain,
    orchestrator: args.orchestrator,
    agentRegistry: args.agentRegistry,
    capabilityRegistry,
    constitution: args.constitution,
    kg: args.kg,
    observations,
    trustStore,
    ...(args.workflowEngine ? { workflowEngine: args.workflowEngine } : {}),
    ...(args.mcp ? { mcp: args.mcp } : {}),
    ...(args.audio ? { audio: args.audio } : {}),
    ...(args.openClawModel ? { openClawModel: args.openClawModel } : {}),
    handleRequest,
    route,
  });
}
