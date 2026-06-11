/**
 * living-md-wiring.ts — the COMPOSITION ROOT of the LIVING-MD organ.
 *
 * THE ORGAN = the composition that CLOSES the felt loop over the already-durable
 * substrate. The storage is already correct (`md_commitments`, migration 0321 +
 * the timeline/governance tables, 0339/0340). What was DARK is the felt loop:
 * the owner had no lens on the durable plan, and the chat turn neither re-read
 * the ledger (violating the Magentic-One dual-ledger discipline) nor reacted to
 * it (violating reconciliation-sweep-as-heartbeat → must reach the conversation).
 * This module wires the leaf organs into ONE seam so the composition root plugs
 * it in with a single `createLivingMdOrgan(...)` call:
 *
 *   - commitmentStatePort  — the per-turn FRESH ledger re-read (chat lens);
 *   - turnHooks            — the pre-turn injection + post-turn commitment_state
 *                            effects (the felt diff in the conversation);
 *   - timelineSink         — the append-only, hash-chained lifecycle trail;
 *   - governanceStore      — the per-tenant set-points read FRESH each tick;
 *   - mdEventBus           — the INJECTED in-process bus (replaces the `global`
 *                            anti-pattern) the ledger/webhook seams emit onto;
 *   - somedayReviewSupervisor — the deferred-resurfacing leader-gated cron.
 *
 * `deps` are all produced by `createMdCommitmentReconciliation(...)` (which
 * already returns `{ reconciliation, repository, eventSubscriber }`) and
 * `estate-mind-wiring` (the `tabEventLogProposalSink`). This is PURE composition
 * over existing fragments — it builds no new storage and reaches into no DB
 * directly except through the leaf sinks it constructs.
 *
 * No `console.*` (Pino shim only). Immutable, frozen return. A boot-proof
 * structured log at composition time makes the organ going dark detectable.
 */

import type { MdCommitmentRepository } from '@borjie/database/repositories';
import type { WaitForEventSubscriber } from '../md-commitments/wait-for.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

import {
  createCommitmentStatePort,
  type CommitmentStatePort,
} from './commitment-state-port.js';
import {
  createTimelineSink,
  type TimelineDbLike,
  type TimelineSink,
} from './timeline-event-sink.js';
import {
  createGovernanceStore,
  type GovernanceDbLike,
  type GovernanceStore,
} from './governance-store.js';
import {
  createMdEventBus,
  type MdEventBus,
} from './event-subscriber-wiring.js';
import {
  createTurnCommitmentHooks,
  type SovereignInboxDraftPort,
  type TurnCommitmentHooks,
} from './turn-commitment-hooks.js';
import {
  createSomedayReviewSupervisor,
  type ProposalSinkLike,
  type SomedayReviewHandle,
} from './someday-review-supervisor.js';

export interface CreateLivingMdOrganDeps {
  /** The durable commitment store (from createMdCommitmentReconciliation). */
  readonly repository: MdCommitmentRepository;
  /** The WaitFor event subscriber (already returned by estate-mind-wiring). */
  readonly eventSubscriber: WaitForEventSubscriber;
  /** The gated proposal sink (tab_event_log proactive_nudge contract). */
  readonly proposalSink: ProposalSinkLike | null;
  /** Active-tenant discovery for the someday supervisor (heartbeat SELECT). */
  readonly listActiveTenantIds: () => Promise<ReadonlyArray<string>>;
  /**
   * The raw DB seam for the timeline sink + governance store. Null → both
   * degrade to honest no-ops / safe defaults (the organ still composes).
   */
  readonly db: (TimelineDbLike & GovernanceDbLike) | null;
  /** Optional sovereign safe-halt inbox draft port (post-turn effect). */
  readonly sovereignInbox?: SovereignInboxDraftPort | null;
  readonly logger?: PinoLikeLogger;
  readonly clock?: () => Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test override for the someday cron (NODE_ENV=test is inert otherwise). */
  readonly somedayEnabled?: boolean;
  readonly somedayIntervalMs?: number;
}

export interface LivingMdOrgan {
  readonly commitmentStatePort: CommitmentStatePort;
  readonly turnHooks: TurnCommitmentHooks;
  readonly timelineSink: TimelineSink;
  readonly governanceStore: GovernanceStore;
  readonly mdEventBus: MdEventBus;
  readonly somedayReviewSupervisor: SomedayReviewHandle;
}

/**
 * Compose the living-MD organ. Pure composition over the existing fragments:
 * builds the chat read-port, the turn hooks, the timeline sink, the governance
 * store, the injected event bus, and the someday-review supervisor, and returns
 * them frozen for the composition root to wire into the chat layer + cron seam.
 */
export function createLivingMdOrgan(
  deps: CreateLivingMdOrganDeps,
): LivingMdOrgan {
  const logger = deps.logger ?? createPinoLikeLogger('living-md');
  const clock = deps.clock ?? (() => new Date());

  const timelineSink = createTimelineSink({
    db: deps.db,
    logger,
    clock,
  });

  const governanceStore = createGovernanceStore({
    db: deps.db,
    logger,
  });

  const commitmentStatePort = createCommitmentStatePort({
    repository: deps.repository,
    clock,
  });

  const mdEventBus = createMdEventBus({
    eventSubscriber: deps.eventSubscriber,
    logger,
    clock,
  });

  const turnHooks = createTurnCommitmentHooks({
    statePort: commitmentStatePort,
    governanceStore,
    sovereignInbox: deps.sovereignInbox ?? null,
    logger,
  });

  const somedayReviewSupervisor = createSomedayReviewSupervisor({
    repository: deps.repository,
    governanceStore,
    proposalSink: deps.proposalSink,
    timelineSink,
    listActiveTenantIds: deps.listActiveTenantIds,
    logger,
    clock,
    ...(deps.env ? { env: deps.env } : {}),
    ...(deps.somedayEnabled !== undefined ? { enabled: deps.somedayEnabled } : {}),
    ...(deps.somedayIntervalMs !== undefined
      ? { intervalMs: deps.somedayIntervalMs }
      : {}),
  });

  // BOOT-PROOF SIGNAL — the organ going dark again is detectable.
  logger.info(
    {
      wiring: 'living-md',
      dbWired: deps.db !== null,
      proposalSinkWired: deps.proposalSink !== null,
      sovereignInboxWired: Boolean(deps.sovereignInbox),
    },
    'living-md: organ composed (state-port + turn-hooks + timeline + governance + event-bus + someday-review) — the felt loop closed, propose-only/HITL',
  );

  return Object.freeze({
    commitmentStatePort,
    turnHooks,
    timelineSink,
    governanceStore,
    mdEventBus,
    somedayReviewSupervisor,
  });
}
