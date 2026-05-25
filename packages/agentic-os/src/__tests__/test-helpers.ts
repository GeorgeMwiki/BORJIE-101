/**
 * Test helpers — fake brain, fake registry, fake stores. Shared across
 * the test suite so each behaviour test stays small + focused.
 */

import type {
  AgentMatch,
  AgentRegistryPort,
  AgentSummary,
  AutonomyLevel,
  BrainPort,
  CapabilityRegistryPort,
  ConstitutionClauseSummary,
  ConstitutionPort,
  Goal,
  IntentClassification,
  KGPort,
  KGTripleDelta,
  MCPPort,
  Observation,
  ObservationStorePort,
  OpenClawPort,
  PreflightDecision,
  ReflectionUpdate,
  RequestEnvelope,
  SubGoal,
  SubGoalResult,
  TrustOutcome,
  TrustScore,
  TrustStorePort,
  WorkflowEnginePort,
} from '../types.js';
import { nowIso } from '../types.js';
import { createInMemoryCapabilityRegistry } from '../capability-registry/index.js';
import type { OrchestratorPort } from '../goal-engine/index.js';

// ============================================================================
// Brain
// ============================================================================

export interface FakeBrainConfig {
  readonly intent?: IntentClassification;
  readonly goal?: Goal;
  readonly subGoals?: ReadonlyArray<SubGoal>;
  readonly reflection?: ReflectionUpdate;
  readonly throwOn?: 'classify' | 'compose' | 'decompose' | 'reflect';
}

export function makeFakeBrain(cfg: FakeBrainConfig = {}): BrainPort {
  return {
    async classifyIntent({ envelope }) {
      if (cfg.throwOn === 'classify') throw new Error('classify failed');
      if (cfg.intent) return cfg.intent;
      return Object.freeze<IntentClassification>({
        primary: 'lease.renew',
        secondary: [],
        confidence: 0.85,
        rationale: `inferred from utterance: ${envelope.utterance}`,
        suggestedDomain: 'lease',
        riskClass: 'med',
        entities: { tenantId: envelope.tenantId },
      });
    },
    async composeGoal({ envelope, intent }) {
      if (cfg.throwOn === 'compose') throw new Error('compose failed');
      if (cfg.goal) return cfg.goal;
      return Object.freeze<Goal>({
        id: `goal-${envelope.requestId}`,
        requestId: envelope.requestId,
        tenantId: envelope.tenantId,
        intent,
        headline: `Handle ${intent.primary}`,
        successCriteria: [
          { id: 'crit-1', check: 'intent.completed', weight: 1 },
        ],
        scope: { tenantId: envelope.tenantId },
        createdAt: nowIso(),
      });
    },
    async decomposeGoal({ goal, candidates }) {
      if (cfg.throwOn === 'decompose') throw new Error('decompose failed');
      if (cfg.subGoals) return cfg.subGoals;
      const first = candidates[0];
      if (!first) return [];
      return [
        Object.freeze<SubGoal>({
          id: `sg-${goal.id}-1`,
          parentGoalId: goal.id,
          description: 'execute primary capability',
          assignedAgentId: first.agentId,
          capabilityId: first.capabilityId,
          dependsOn: [],
          inputs: {},
          createdAt: nowIso(),
        }),
      ];
    },
    async reflect({ agentId, observations }) {
      if (cfg.throwOn === 'reflect') throw new Error('reflect failed');
      if (cfg.reflection) return cfg.reflection;
      return Object.freeze<ReflectionUpdate>({
        agentId,
        windowStart: nowIso(),
        windowEnd: nowIso(),
        observationCount: observations.length,
        outcomesByKind: {
          success: 1,
          partial: 0,
          failure: 0,
          escalated: 0,
        },
        summary: `processed ${observations.length} observations`,
        proposedImprovements: [],
        trustAdjustments: [],
        generatedAt: nowIso(),
      });
    },
  };
}

// ============================================================================
// Agent registry
// ============================================================================

export function makeFakeAgentRegistry(
  initial: ReadonlyArray<AgentSummary> = [],
): AgentRegistryPort {
  const agents = new Map(initial.map((a) => [a.agentId, a]));
  return {
    async getAgent(agentId) {
      return agents.get(agentId) ?? null;
    },
    async listAgents() {
      return Array.from(agents.values());
    },
    async getAutonomyLevel({ agentId, domainId }) {
      const a = agents.get(agentId);
      if (!a) return null;
      return a.defaultAutonomyByDomain.get(domainId) ?? null;
    },
  };
}

export function makeAgentSummary(args: {
  readonly agentId: string;
  readonly domains?: ReadonlyArray<string>;
  readonly autonomy?: AutonomyLevel;
}): AgentSummary {
  return {
    agentId: args.agentId,
    name: args.agentId,
    supportedDomains: args.domains ?? ['general'],
    defaultAutonomyByDomain: new Map(
      (args.domains ?? ['general']).map(
        (d) => [d, (args.autonomy ?? 'L2') as AutonomyLevel],
      ),
    ),
  };
}

// ============================================================================
// Capability registry (re-export the in-memory implementation)
// ============================================================================

export function makeCapabilityRegistry(): CapabilityRegistryPort {
  return createInMemoryCapabilityRegistry();
}

// ============================================================================
// Trust store
// ============================================================================

export function makeFakeTrustStore(
  initial: ReadonlyArray<TrustScore> = [],
): TrustStorePort {
  const scores = new Map(
    initial.map((s) => [`${s.agentId}::${s.capabilityId}`, s]),
  );
  const outcomes: TrustOutcome[] = [];
  return {
    async recordOutcome(o) {
      outcomes.push(o);
    },
    async getScore({ agentId, capabilityId }) {
      return scores.get(`${agentId}::${capabilityId}`) ?? null;
    },
    async list() {
      return Array.from(scores.values());
    },
  };
}

// ============================================================================
// Observation store
// ============================================================================

export interface FakeObservationStore extends ObservationStorePort {
  readonly observations: ReadonlyArray<Observation>;
}

export function makeFakeObservationStore(): FakeObservationStore {
  const observations: Observation[] = [];
  return {
    get observations() {
      return observations as ReadonlyArray<Observation>;
    },
    async emit(o) {
      observations.push(o);
    },
    async list(args) {
      return observations.filter((o) => {
        if (args.agentId && o.agentId !== args.agentId) return false;
        if (args.tenantId && o.tenantId !== args.tenantId) return false;
        if (args.goalId && o.goalId !== args.goalId) return false;
        if (args.sinceIso && o.at < args.sinceIso) return false;
        if (args.untilIso && o.at > args.untilIso) return false;
        return true;
      });
    },
  };
}

// ============================================================================
// Constitution port
// ============================================================================

export interface FakeConstitutionConfig {
  readonly decision?: PreflightDecision;
  readonly firedClauses?: ReadonlyArray<ConstitutionClauseSummary>;
  readonly rationale?: string;
}

export function makeFakeConstitution(
  cfg: FakeConstitutionConfig = {},
): ConstitutionPort {
  return {
    async evaluate() {
      return {
        decision: cfg.decision ?? 'allow',
        firedClauses: cfg.firedClauses ?? [],
        rationale: cfg.rationale ?? 'no clauses fired',
      };
    },
  };
}

// ============================================================================
// Workflow engine port
// ============================================================================

export function makeFakeWorkflowEngine(): WorkflowEnginePort {
  let counter = 0;
  return {
    async openApprovalRun() {
      counter += 1;
      return { runId: `run-${counter}` };
    },
  };
}

// ============================================================================
// KG port
// ============================================================================

export interface FakeKG extends KGPort {
  readonly deltas: ReadonlyArray<KGTripleDelta>;
  setSubgraph(triples: ReadonlyArray<{
    readonly subjectId: string;
    readonly predicate: string;
    readonly objectId: string;
  }>): void;
}

export function makeFakeKG(): FakeKG {
  const deltas: KGTripleDelta[] = [];
  let subgraph: ReadonlyArray<{
    readonly subjectId: string;
    readonly predicate: string;
    readonly objectId: string;
  }> = [];
  return {
    get deltas() {
      return deltas as ReadonlyArray<KGTripleDelta>;
    },
    setSubgraph(triples) {
      subgraph = triples;
    },
    async applyDeltas({ deltas: ds }) {
      for (const d of ds) deltas.push(d);
    },
    async fetchSubgraph({ subjectIds }) {
      return subgraph.filter((t) => subjectIds.includes(t.subjectId));
    },
  };
}

// ============================================================================
// OpenClaw port
// ============================================================================

export function makeFakeOpenClaw(
  caps: ReadonlyMap<string, AutonomyLevel> = new Map(),
): OpenClawPort {
  return {
    async capForJurisdiction({ jurisdiction, riskClass }) {
      const key = `${jurisdiction}::${riskClass}`;
      return caps.get(key) ?? 'L3';
    },
  };
}

// ============================================================================
// MCP port
// ============================================================================

export function makeFakeMCP(toolNames: ReadonlyArray<string> = []): MCPPort {
  const set = new Set(toolNames);
  return {
    async hasTool(name) {
      return set.has(name);
    },
  };
}

// ============================================================================
// Orchestrator (executes subgoals)
// ============================================================================

export interface FakeOrchestratorConfig {
  readonly outcome?: 'success' | 'partial' | 'failure' | 'escalated';
  readonly perAgentOutcomes?: ReadonlyMap<string, 'success' | 'partial' | 'failure' | 'escalated'>;
  readonly latencyMs?: number;
  readonly costUsdCents?: number;
}

export function makeFakeOrchestrator(
  cfg: FakeOrchestratorConfig = {},
): OrchestratorPort {
  return {
    async runSubGoal({ subGoal }) {
      const outcome =
        cfg.perAgentOutcomes?.get(subGoal.assignedAgentId) ??
        cfg.outcome ??
        'success';
      const result: SubGoalResult = Object.freeze({
        subGoalId: subGoal.id,
        outcome,
        output: { ran: true },
        reason: `ran subgoal ${subGoal.id}`,
        latencyMs: cfg.latencyMs ?? 100,
        costUsdCents: cfg.costUsdCents ?? 5,
        completedAt: nowIso(),
      });
      return result;
    },
  };
}

// ============================================================================
// Envelope builder
// ============================================================================

export function makeEnvelope(
  overrides: Partial<RequestEnvelope> = {},
): RequestEnvelope {
  const base: Record<string, unknown> = {
    requestId: overrides.requestId ?? `req-${Math.random().toString(36).slice(2, 10)}`,
    channel: overrides.channel ?? 'http',
    tenantId: overrides.tenantId ?? 'tenant-1',
    jurisdiction: overrides.jurisdiction ?? 'TZ',
    utterance: overrides.utterance ?? 'please renew my lease',
    receivedAt: overrides.receivedAt ?? nowIso(),
  };
  if (overrides.userId !== undefined) base.userId = overrides.userId;
  else base.userId = 'user-1';
  if (overrides.payload !== undefined) base.payload = overrides.payload;
  if (overrides.metadata !== undefined) base.metadata = overrides.metadata;
  return Object.freeze(base) as unknown as RequestEnvelope;
}

// ============================================================================
// AgentMatch helper
// ============================================================================

export function makeAgentMatch(
  overrides: Partial<AgentMatch> = {},
): AgentMatch {
  return Object.freeze({
    agentId: overrides.agentId ?? 'agent-1',
    capabilityId: overrides.capabilityId ?? 'lease.renew',
    score: overrides.score ?? 0.75,
    breakdown: overrides.breakdown ?? {
      trustScore: 0.8,
      capabilityFit: 0.9,
      costPenalty: 0.1,
      latencyPenalty: 0.1,
      autonomyHeadroom: 1.0,
    },
  });
}
