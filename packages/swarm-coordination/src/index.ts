/**
 * `@borjie/swarm-coordination` — public surface.
 *
 * Wave 18HH. The spatial-coordination layer for the Borjie agent
 * swarm. Every running Mr. Mwikila instance knows what every peer
 * is doing, in real-time. Conflict resolution when peers propose
 * contradicting actions. Sibling Wave 18GG (amnesia / temporal
 * continuity) handles "what did *I* do five minutes ago?"; this
 * package handles "what are my PEERS doing right now?"
 *
 * Spec: `Docs/DESIGN/AGENT_SWARM_COORDINATION_SOTA.md`.
 * Persona: Mr. Mwikila (Managing Director). Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types — public type surface
// ---------------------------------------------------------------------------

export type {
  ActiveAgent,
  ActiveAgentsRepository,
  AgentKind,
  AgentMessage,
  AgentMessageKind,
  AgentMessagesRepository,
  AgentRole,
  AgentStatus,
  AgentSubject,
  BlackboardContributionKind,
  BlackboardPosting,
  BlackboardRepository,
  ConflictResolutionKind,
  ConflictsRepository,
  CoordinationConflict,
  OpenConflictInput,
  PostContributionInput,
  RegisterAgentInput,
  SendMessageInput,
} from './types.js';

export { SWARM_CONSTANTS } from './types.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export {
  createActiveAgentsRegistry,
  type ActiveAgentsRegistry,
} from './registry/active-agents-registry.js';
export {
  runStaleCleaner,
  type StaleCleanerResult,
  type StaleCleanerDeps,
} from './registry/stale-cleaner.js';

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export {
  createA2ASender,
  type A2ASender,
  type ValidatedSendInput,
} from './messaging/a2a-sender.js';
export {
  createA2AReceiver,
  type A2AReceiver,
} from './messaging/a2a-receiver.js';
export {
  classifyRouting,
  type RoutingMode,
} from './messaging/message-router.js';

// ---------------------------------------------------------------------------
// Blackboard
// ---------------------------------------------------------------------------

export {
  createBlackboardPoster,
  type BlackboardPoster,
  type BlackboardPostResult,
  type ValidatedPostInput,
} from './blackboard/blackboard-poster.js';
export {
  createBlackboardReader,
  type BlackboardReader,
} from './blackboard/blackboard-reader.js';
export {
  resolveTipPostings,
  findOrphanSupersedences,
} from './blackboard/supersedence-resolver.js';

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

export {
  createConflictDetector,
  type ConflictDetectionResult,
  type ConflictDetectorDeps,
  type PendingProposalRef,
} from './conflict/conflict-detector.js';
export {
  createReconciliationSpawner,
  type ReconciliationKernel,
  type ReconciliationKernelOutput,
  type ReconciliationSpawnResult,
  type ReconciliationSpawnerDeps,
} from './conflict/reconciliation-spawner.js';

// ---------------------------------------------------------------------------
// Coordination patterns
// ---------------------------------------------------------------------------

export {
  createSupervisorWorker,
  type SupervisorWorkerDeps,
  type SupervisorWorkerRunInput,
  type SupervisorWorkerRunResult,
  type WorkerExecutor,
} from './patterns/supervisor-worker.js';
export {
  createPeerDebate,
  type DebaterExecutor,
  type PeerDebateDeps,
  type PeerDebateRunInput,
  type PeerDebateRunResult,
} from './patterns/peer-debate.js';
export {
  createConsensus,
  type ConsensusDeps,
  type ConsensusRunInput,
  type ConsensusRunResult,
  type ConsensusVote,
  type ConsensusVoter,
} from './patterns/consensus.js';
export {
  createPipeline,
  type PipelineDeps,
  type PipelineRunInput,
  type PipelineRunResult,
  type PipelineStage,
} from './patterns/pipeline.js';
export {
  createStigmergyCoordinator,
  type PheromoneDepositInput,
  type PheromoneReadInput,
  type PheromoneSignal,
  type StigmergyPort,
} from './patterns/stigmergy.js';

// ---------------------------------------------------------------------------
// Storage adapters (in-memory; production wires Drizzle on the database pkg)
// ---------------------------------------------------------------------------

export { createInMemoryActiveAgentsRepository } from './storage/active-agents-repository.js';
export { createInMemoryAgentMessagesRepository } from './storage/agent-messages-repository.js';
export { createInMemoryBlackboardRepository } from './storage/blackboard-repository.js';
export { createInMemoryConflictsRepository } from './storage/conflicts-repository.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export { computeSwarmAuditHash } from './audit/audit-chain-link.js';
