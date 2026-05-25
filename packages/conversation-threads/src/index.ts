/**
 * @borjie/conversation-threads — Piece F of the BORJIE master plan.
 *
 * Public surface:
 *   types          — Zod schemas + TS types for Project, Thread, Message, Artifact, Pin
 *   projects       — project CRUD with MAX_TIER_FOR_PROJECTS gate
 *   threads        — thread CRUD, fork, WhatsApp 24h-window rollover
 *   messages       — append-only with SHA-256 hash chain
 *   artifacts      — versioned artifacts with branch operation
 *   retrieval      — cross-thread retrieval scoped to (tenant, persona, project)
 *   hash-chain     — pure helpers for chain hashing + verification
 */

// ── Types ────────────────────────────────────────────────────────────
export {
  ARTIFACT_TYPES,
  ArtifactSchema,
  CHANNEL_VALUES,
  MESSAGE_ROLES,
  MessageSchema,
  PinSchema,
  ProjectSchema,
  ThreadSchema,
} from './types.js';

export type {
  Artifact,
  ArtifactType,
  Channel,
  Message,
  MessageRole,
  Pin,
  Project,
  RetentionPolicy,
  Thread,
} from './types.js';

// ── Hash chain ───────────────────────────────────────────────────────
export {
  GENESIS_HASH,
  canonicalJson,
  computeMessageHash,
  verifyMessageChain,
} from './hash-chain.js';

export type {
  ChainVerifyResult,
  ComputeMessageHashArgs,
  MessageHashRow,
} from './hash-chain.js';

// ── Projects ─────────────────────────────────────────────────────────
export {
  MAX_TIER_FOR_PROJECTS,
  ProjectTierError,
  archiveProject,
  createInMemoryProjectRepository,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from './projects.js';

export type {
  CreateProjectArgs,
  ProjectRepository,
} from './projects.js';

// ── Threads ──────────────────────────────────────────────────────────
export {
  WHATSAPP_24H_WINDOW_MS,
  archiveThread,
  computeChainRootHash,
  createInMemoryThreadRepository,
  createThread,
  findOrCreateCustomerThread,
  forkThread,
  listThreads,
} from './threads.js';

export type {
  CreateThreadArgs,
  FindOrCreateCustomerThreadResult,
  ThreadRepository,
} from './threads.js';

// ── Messages ─────────────────────────────────────────────────────────
export {
  appendMessage,
  createInMemoryMessageRepository,
  listMessages,
  verifyThreadChain,
} from './messages.js';

export type {
  AppendMessageArgs,
  MessageRepository,
} from './messages.js';

// ── Artifacts ────────────────────────────────────────────────────────
export {
  artifactVersionKey,
  branchArtifact,
  bumpArtifactVersion,
  createArtifact,
  createInMemoryArtifactRepository,
  listArtifactVersions,
} from './artifacts.js';

export type {
  ArtifactRepository,
  BranchArtifactArgs,
  BumpVersionArgs,
  CreateArtifactArgs,
} from './artifacts.js';

// ── Retrieval ────────────────────────────────────────────────────────
export {
  DEFAULT_RETRIEVAL_LIMIT,
  RRF_K,
  createInMemoryRetrievalRepository,
  fuseRrf,
  retrieveCrossThread,
} from './retrieval.js';

export type {
  InMemoryRetrievalIndexEntry,
  RetrievalArgs,
  RetrievalCandidate,
  RetrievalRepository,
} from './retrieval.js';
