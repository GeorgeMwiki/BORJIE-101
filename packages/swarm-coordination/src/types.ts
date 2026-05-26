/**
 * `@borjie/swarm-coordination` — public type surface.
 *
 * Wave 18HH. Mirrors the 4-table schema introduced by migration
 * `0030_swarm_coordination.sql`:
 *
 *   - ActiveAgent           — a row in `active_agents`.
 *   - AgentMessage          — a row in `agent_messages`.
 *   - BlackboardPosting     — a row in `blackboard_postings`.
 *   - CoordinationConflict  — a row in `coordination_conflicts`.
 *
 * Plus the value enumerations the storage layer enforces.
 *
 * Spec: Docs/DESIGN/AGENT_SWARM_COORDINATION_SOTA.md.
 */

// ---------------------------------------------------------------------------
// Value enumerations — match the SQL CHECK constraints in 0030_*.sql
// ---------------------------------------------------------------------------

/**
 * Kind of agent registering itself in the active registry. Every running
 * Mr. Mwikila instance is exactly one of these five kinds.
 */
export type AgentKind =
  | 'root_md'
  | 'district_md'
  | 'specialisation'
  | 'spawned_wave'
  | 'background_worker';

/**
 * The six coordination roles an agent plays at any moment. Soft field —
 * stored inside `active_agents.subject.role` and used by the patterns
 * layer to assemble agent sets.
 */
export type AgentRole =
  | 'orchestrator'
  | 'worker'
  | 'verifier'
  | 'critic'
  | 'mediator'
  | 'observer';

/** Lifecycle of an `active_agents` row. */
export type AgentStatus = 'running' | 'paused' | 'completed' | 'crashed';

/** Canonical A2A message kinds. */
export type AgentMessageKind =
  | 'inform'
  | 'request'
  | 'coordinate'
  | 'conflict'
  | 'handoff';

/** Canonical blackboard contribution kinds. */
export type BlackboardContributionKind =
  | 'observation'
  | 'hypothesis'
  | 'question'
  | 'plan'
  | 'result';

/** Resolution outcomes for a `coordination_conflicts` row. */
export type ConflictResolutionKind =
  | 'ai_reconciled'
  | 'owner_picked'
  | 'both_rejected';

// ---------------------------------------------------------------------------
// Subject — the canonical "what is the agent working on" record
// ---------------------------------------------------------------------------

/**
 * Subject identifier carried by every active-agent row, A2A message,
 * blackboard posting, and conflict row. The `(kind, id)` pair is the
 * join key for subject-scoped queries.
 */
export interface AgentSubject {
  readonly kind: string;
  readonly id: string;
  readonly summary?: string;
  readonly role?: AgentRole;
}

// ---------------------------------------------------------------------------
// Domain records — one type per row, immutable readonly shapes
// ---------------------------------------------------------------------------

export interface ActiveAgent {
  readonly id: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentKind: AgentKind;
  readonly scopeId: string | null;
  readonly subject: AgentSubject | null;
  readonly parentAgentId: string | null;
  readonly startedAt: Date;
  readonly expectedCompletionAt: Date | null;
  readonly heartbeatAt: Date;
  readonly status: AgentStatus;
  readonly auditHash: string;
}

export interface AgentMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string | null;
  readonly toSubject: AgentSubject | null;
  readonly messageKind: AgentMessageKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sentAt: Date;
  readonly ackAt: Date | null;
  readonly auditHash: string;
}

export interface BlackboardPosting {
  readonly id: string;
  readonly tenantId: string;
  readonly scopeId: string | null;
  readonly postedByAgentId: string;
  readonly subject: AgentSubject;
  readonly contributionKind: BlackboardContributionKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly supersedesPostingId: string | null;
  readonly postedAt: Date;
  readonly auditHash: string;
}

export interface CoordinationConflict {
  readonly id: string;
  readonly tenantId: string;
  readonly subject: AgentSubject;
  readonly conflictingProposalIds: ReadonlyArray<string>;
  readonly detectedAt: Date;
  readonly resolutionKind: ConflictResolutionKind | null;
  readonly reconciliationPayload: Readonly<Record<string, unknown>> | null;
  readonly resolvedAt: Date | null;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Input shapes — what the application passes when creating rows
// ---------------------------------------------------------------------------

export interface RegisterAgentInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentKind: AgentKind;
  readonly scopeId?: string;
  readonly subject?: AgentSubject;
  readonly parentAgentId?: string;
  readonly expectedCompletionAt?: Date;
}

export interface SendMessageInput {
  readonly tenantId: string;
  readonly fromAgentId: string;
  readonly messageKind: AgentMessageKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly toAgentId?: string;
  readonly toSubject?: AgentSubject;
}

export interface PostContributionInput {
  readonly tenantId: string;
  readonly postedByAgentId: string;
  readonly subject: AgentSubject;
  readonly contributionKind: BlackboardContributionKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly scopeId?: string;
  readonly supersedesPostingId?: string;
}

export interface OpenConflictInput {
  readonly tenantId: string;
  readonly subject: AgentSubject;
  readonly conflictingProposalIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Repository contract — the storage layer the registry/messaging/blackboard
// modules call. In-memory adapter ships with the package; production wires
// a Drizzle adapter on the database package.
// ---------------------------------------------------------------------------

export interface ActiveAgentsRepository {
  register(input: RegisterAgentInput): Promise<ActiveAgent>;
  heartbeat(tenantId: string, id: string): Promise<void>;
  deregister(
    tenantId: string,
    id: string,
    terminalStatus: Exclude<AgentStatus, 'running'>,
  ): Promise<void>;
  listRunningOnSubject(
    tenantId: string,
    subject: AgentSubject,
  ): Promise<ReadonlyArray<ActiveAgent>>;
  listStaleRunning(
    olderThan: Date,
  ): Promise<ReadonlyArray<ActiveAgent>>;
}

export interface AgentMessagesRepository {
  send(input: SendMessageInput): Promise<AgentMessage>;
  pullUnacked(
    tenantId: string,
    toAgentId: string,
  ): Promise<ReadonlyArray<AgentMessage>>;
  pullSubjectScoped(
    tenantId: string,
    subject: AgentSubject,
  ): Promise<ReadonlyArray<AgentMessage>>;
  ack(tenantId: string, id: string): Promise<void>;
}

export interface BlackboardRepository {
  post(input: PostContributionInput): Promise<BlackboardPosting>;
  readSubject(
    tenantId: string,
    subject: AgentSubject,
    scopeId?: string,
  ): Promise<ReadonlyArray<BlackboardPosting>>;
}

export interface ConflictsRepository {
  open(input: OpenConflictInput): Promise<CoordinationConflict>;
  resolve(
    tenantId: string,
    id: string,
    kind: ConflictResolutionKind,
    reconciliationPayload: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  listUnresolved(
    tenantId: string,
  ): Promise<ReadonlyArray<CoordinationConflict>>;
}

/**
 * Spec constants — read by patterns, registry, and conflict modules.
 */
export const SWARM_CONSTANTS = {
  /** Default heartbeat cadence (ms). */
  HEARTBEAT_INTERVAL_MS: 30_000,
  /** Stale threshold — agents silent longer than this are crash-cleared. */
  STALE_THRESHOLD_MS: 120_000,
  /** Cron tick for the stale-cleaner. */
  STALE_CLEANER_INTERVAL_MS: 60_000,
  /** Default A2A request ack timeout. */
  A2A_REQUEST_ACK_TIMEOUT_MS: 60_000,
  /** Default receiver long-poll tick. */
  A2A_RECEIVER_TICK_MS: 200,
  /** Default peer-debate rounds. */
  PEER_DEBATE_ROUNDS: 2,
} as const;
