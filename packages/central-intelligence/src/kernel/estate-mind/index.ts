/**
 * `estate-mind` — public surface of the resident per-tenant Slow Loop
 * (Wave 1, organ #1). PERCEIVE → ORIENT → drives → goals → gated PROPOSALS,
 * holding the situational model between ticks. Never executes
 * sovereign/money/licence actions (HITL forever); behind flag
 * BORJIE_ESTATE_MIND (default OFF — wired by the api-gateway heartbeat).
 */

export {
  createEstateMind,
  type EstateMind,
  type PendingProposalReader,
  createInMemoryPendingProposalReader,
} from './estate-mind.js';

export {
  type EstateMindDeps,
  type EstateMindTickResult,
  type EstateMindCycleResult,
  type EstateProposal,
  type PerceptionSource,
  type ProposalSink,
  type ReconciliationPort,
  type ReconcileResult,
  type GapWatchPort,
  type GapWatchSummary,
} from './types.js';
