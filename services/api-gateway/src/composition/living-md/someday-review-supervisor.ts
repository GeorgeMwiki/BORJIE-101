/**
 * someday-review-supervisor.ts — the deferred-RESURFACING scheduler (the
 * LIVING-MD organ's "naturally bring deferred work back when its time arrives").
 *
 * THE GAP THIS CLOSES
 * -------------------
 * GTD's `someday` class is the long-horizon parking lot: items the MD set aside
 * with intent but that are INVISIBLE to the chat lens + the reconcile sweep
 * until the owner re-reviews them (the felt-plan "someday is invisible unless
 * owner re-reviewed" rail). Without a scheduler they would sit dark forever.
 * This leader-gated cron is the ONLY path that resurfaces them: on the owner's
 * tunable cadence it reads every live `someday` commitment per tenant and emits
 * a `someday_review` proposal through the EXISTING gated proposal sink (the same
 * proactive_nudge contract the owner cockpit inbox already drains) — never a new
 * surface, never an auto-action. Items parked >1yr are EXPIRED with an owner
 * notification (a proposal flagged as an expiry) and blocked out of the live set.
 *
 * MODELLED EXACTLY ON aop-wiring.ts / loop-economy-wiring.ts:
 *   - the same leader-gated `start()` / `stop()` / `tickOnce()` shape (the
 *     composition root wraps it in `withClusterLeader`);
 *   - DEFAULT-ON kill-switch `BORJIE_SOMEDAY_REVIEW` (only off/0/false/no
 *     disables); inert under NODE_ENV=test unless a test passes `enabled`;
 *   - clamped cadence (read FRESH from the governance store each tick — never
 *     cached — per the felt-plan "governance read fresh each tick" rail);
 *   - a fail-safe tick: every step try/caught, a fault increments a counter and
 *     logs via the Pino-shape logger, never crashes boot / a request / the
 *     interval; the timer is `unref()`-ed;
 *   - a boot-proof structured log at composition time (the organ going dark
 *     again is detectable).
 *
 * READ + PROPOSE ONLY: the supervisor never writes money/ledger/licence state.
 * Its only act path is the gated proposal sink (propose-only, HITL downstream).
 * Sovereign someday items are surfaced for review exactly like any other — they
 * are never auto-actuated (the safe-halt hard rail). No `console.*` (Pino shim).
 */

import type { MdCommitment, MdCommitmentRepository } from '@borjie/database/repositories';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import type { GovernanceStore } from './governance-store.js';
import type { TimelineSink } from './timeline-event-sink.js';

// ─────────────────────────────────────────────────────────────────────
// Tunables — clamped so a bad env / governance row can never run away.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily wake; cadence gates work
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1-hour floor (SAFETY bound)
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day ceiling
/** Hard cap on tenants reviewed per tick (DB-read bound). */
const DEFAULT_MAX_TENANTS_PER_TICK = 200;
/** A someday item parked longer than this is expired with an owner notice. */
const SOMEDAY_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
/** Cap on someday proposals surfaced per tenant per tick (inbox-spam bound). */
const MAX_REVIEWS_PER_TENANT = 10;

/** DEFAULT-ON kill-switch (only off/0/false/no disables). */
export const SOMEDAY_REVIEW_KILL_SWITCH_ENV = 'BORJIE_SOMEDAY_REVIEW';

/** The valid kernel DriveId union the proposal requires (coalescing key only). */
const VALID_DRIVE_IDS = [
  'cash-runway',
  'licence-currency',
  'safety',
  'offtake-coverage',
  'royalty-currency',
  'equipment-health',
] as const;
type DriveId = (typeof VALID_DRIVE_IDS)[number];

/** A minimal proposal the supervisor surfaces (decoupled from the kernel type). */
export interface SomedayProposalLike {
  readonly tenantId: string;
  readonly id: string;
  readonly driveId: DriveId;
  readonly title: string;
  readonly rationale: string;
  readonly locale?: 'en' | 'sw';
  readonly urgency: 'low' | 'medium' | 'high' | 'critical';
  readonly breachSeverity: number;
  readonly evidenceEntityIds: ReadonlyArray<string>;
  readonly proposedAtMs: number;
}

/** The gated proposal sink (structurally the kernel ProposalSink). */
export interface ProposalSinkLike {
  propose(proposal: SomedayProposalLike): Promise<boolean>;
}

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));
}

function killSwitchOff(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const v = (env[SOMEDAY_REVIEW_KILL_SWITCH_ENV] ?? '').trim().toLowerCase();
  return v === 'off' || v === '0' || v === 'false' || v === 'no';
}

/** Map a commitment's competence domain → a valid coalescing driveId. */
function driveIdForDomain(domain: string | null): DriveId {
  switch (domain) {
    case 'licence':
    case 'licences':
      return 'licence-currency';
    case 'royalty':
      return 'royalty-currency';
    case 'safety':
      return 'safety';
    case 'offtake':
    case 'marketplace':
      return 'offtake-coverage';
    case 'treasury':
    case 'cash':
      return 'cash-runway';
    case 'equipment':
    case 'fleet':
    case 'assets':
      return 'equipment-health';
    default:
      // A neutral, always-valid default — the dedupe id keeps coalescing exact.
      return 'licence-currency';
  }
}

export interface SomedayReviewDeps {
  readonly repository: MdCommitmentRepository;
  readonly governanceStore: GovernanceStore;
  readonly proposalSink: ProposalSinkLike | null;
  readonly timelineSink?: TimelineSink | null;
  /** Active-tenant discovery (the same SELECT the heartbeat uses). */
  readonly listActiveTenantIds: () => Promise<ReadonlyArray<string>>;
  readonly logger?: PinoLikeLogger;
  readonly intervalMs?: number;
  readonly maxTenantsPerTick?: number;
  /** Test override; default: on unless NODE_ENV=test or kill-switch off. */
  readonly enabled?: boolean;
  readonly clock?: () => Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface SomedayReviewTickResult {
  readonly tenantsReviewed: number;
  /** someday items still within their review cadence + horizon, resurfaced. */
  readonly resurfaced: number;
  /** someday items past the 1yr horizon, expired + owner-notified. */
  readonly expired: number;
  /** Resurfaces coalesced by the idempotent sink (already pending). */
  readonly coalesced: number;
  readonly errored: number;
}

export interface SomedayReviewHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<SomedayReviewTickResult>;
}

const ZERO_RESULT: SomedayReviewTickResult = Object.freeze({
  tenantsReviewed: 0,
  resurfaced: 0,
  expired: 0,
  coalesced: 0,
  errored: 0,
});

/**
 * Decide whether a tenant is DUE for a someday review this tick: the cadence
 * gates the WORK (the timer only wakes us). A tenant is due when no review has
 * happened within `cadenceDays`. We approximate "last review" by the freshest
 * someday `updatedAt` the supervisor last touched; in practice the idempotent
 * sink coalesces a re-surface, so re-running inside the cadence is a free no-op
 * — but we still honour the cadence to avoid needless reads. Pure helper.
 */
export function isTenantDueForReview(
  lastReviewMs: number | null,
  cadenceDays: number,
  nowMs: number,
): boolean {
  if (lastReviewMs === null) return true;
  const cadenceMs = Math.max(1, cadenceDays) * 24 * 60 * 60 * 1000;
  return nowMs - lastReviewMs >= cadenceMs;
}

/**
 * Build the someday-review supervisor. Exposes the leader-gated `start()` /
 * `stop()` (the composition root wraps it in `withClusterLeader`) plus
 * `tickOnce()` for tests.
 */
export function createSomedayReviewSupervisor(
  deps: SomedayReviewDeps,
): SomedayReviewHandle {
  const logger = deps.logger ?? createPinoLikeLogger('someday-review');
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => new Date());
  const intervalMs = clampInterval(deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  const maxTenants = Math.max(
    1,
    deps.maxTenantsPerTick ?? DEFAULT_MAX_TENANTS_PER_TICK,
  );
  const enabled =
    deps.enabled ?? (env.NODE_ENV !== 'test' && !killSwitchOff(env));

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  // Per-tenant last-review stamp (in-process; a restart simply re-reviews —
  // the idempotent sink makes that a free coalesce, never a double-nudge).
  const lastReviewByTenant = new Map<string, number>();

  // BOOT-PROOF SIGNAL — the organ going dark again is detectable.
  logger.info(
    {
      wiring: 'someday-review',
      proposalSinkWired: deps.proposalSink !== null,
      timelineSinkWired: Boolean(deps.timelineSink),
      intervalMs,
      maxTenantsPerTick: maxTenants,
      killSwitchEnvFlag: SOMEDAY_REVIEW_KILL_SWITCH_ENV,
      enabled,
    },
    'someday-review: deferred-resurfacing supervisor composed (cadence-gated, propose-only/HITL, someday invisible until re-reviewed)',
  );

  async function reviewTenant(
    tenantId: string,
    counters: { resurfaced: number; expired: number; coalesced: number },
    nowMs: number,
  ): Promise<void> {
    // Governance read FRESH each tick — never cache the cadence (felt rail).
    const gov = await deps.governanceStore.read(tenantId);
    const lastReview = lastReviewByTenant.get(tenantId) ?? null;
    if (!isTenantDueForReview(lastReview, gov.somedayReviewCadenceDays, nowMs)) {
      return; // Not yet due — the cadence gates the work.
    }

    const live = await deps.repository.listLive(tenantId);
    const someday = live.filter((c) => c.class === 'someday');
    let surfaced = 0;
    for (const item of someday) {
      if (surfaced >= MAX_REVIEWS_PER_TENANT) break;
      const ageMs = nowMs - item.createdAtMs;
      const expired = ageMs > SOMEDAY_EXPIRY_MS;
      const done = await surfaceReview(item, tenantId, expired, nowMs);
      if (expired) {
        counters.expired += done.surfaced ? 1 : 0;
        // Expire the item out of the live set (honest, owner-notified above).
        await expireItem(tenantId, item, nowMs);
      } else if (done.surfaced) {
        counters.resurfaced += 1;
      } else {
        counters.coalesced += 1;
      }
      surfaced += 1;
    }
    lastReviewByTenant.set(tenantId, nowMs);
  }

  async function surfaceReview(
    item: MdCommitment,
    tenantId: string,
    expired: boolean,
    nowMs: number,
  ): Promise<{ surfaced: boolean }> {
    if (!deps.proposalSink) return { surfaced: false };
    const locale: 'en' | 'sw' = 'en';
    const titleEn = expired
      ? `Deferred item expired: ${item.title}`
      : `Time to revisit: ${item.title}`;
    const rationaleEn = expired
      ? `This long-horizon item has been parked over a year. Confirm whether to revive or close it — I am taking it off the active list until you decide.`
      : `A someday item you deferred is up for review on your cadence. Want to act on it now, re-defer, or close it?`;
    const proposal: SomedayProposalLike = {
      tenantId,
      // Dedupe id coalesces a re-surface for the SAME item across ticks.
      id: `someday-review:${item.id}`,
      driveId: driveIdForDomain(item.competenceDomain),
      title: titleEn,
      rationale: rationaleEn,
      locale,
      urgency: expired ? 'medium' : 'low',
      breachSeverity: expired ? 0.4 : 0.2,
      evidenceEntityIds:
        item.evidenceIds.length > 0 ? [...item.evidenceIds] : [`commitment:${item.id}`],
      proposedAtMs: nowMs,
    };
    const surfaced = await deps.proposalSink.propose(proposal);
    if (surfaced && deps.timelineSink) {
      await deps.timelineSink.record({
        tenantId,
        commitmentId: item.id,
        eventKind: 'someday_resurfaced',
        previousStatus: item.status,
        newStatus: item.status,
        evidenceIds: item.evidenceIds,
        actor: 'reconcile',
        occurredAtMs: nowMs,
      });
    }
    return { surfaced };
  }

  async function expireItem(
    tenantId: string,
    item: MdCommitment,
    nowMs: number,
  ): Promise<void> {
    try {
      const blocked = await deps.repository.block(
        tenantId,
        item.id,
        'someday item expired after 1 year — parked for owner decision',
      );
      if (blocked && deps.timelineSink) {
        await deps.timelineSink.record({
          tenantId,
          commitmentId: item.id,
          eventKind: 'blocked',
          previousStatus: item.status,
          newStatus: 'blocked',
          evidenceIds: item.evidenceIds,
          actor: 'reconcile',
          occurredAtMs: nowMs,
        });
      }
    } catch (err) {
      logger.warn(
        {
          wiring: 'someday-review',
          tenantId,
          commitmentId: item.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'someday-review: expire-block failed (swallowed)',
      );
    }
  }

  async function tickOnce(): Promise<SomedayReviewTickResult> {
    if (running) return ZERO_RESULT;
    running = true;
    const counters = { resurfaced: 0, expired: 0, coalesced: 0 };
    let tenantsReviewed = 0;
    let errored = 0;
    const nowMs = clock().getTime();
    try {
      const tenants = (await deps.listActiveTenantIds()).slice(0, maxTenants);
      for (const tenantId of tenants) {
        try {
          await reviewTenant(tenantId, counters, nowMs);
          tenantsReviewed += 1;
        } catch (err) {
          errored += 1;
          logger.warn(
            {
              wiring: 'someday-review',
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'someday-review: per-tenant review failed (fail-safe — tick continues)',
          );
        }
      }
    } catch (err) {
      errored += 1;
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'someday-review: tick failed (fail-safe — loop keeps its cadence)',
      );
    } finally {
      running = false;
    }
    return Object.freeze({
      tenantsReviewed,
      resurfaced: counters.resurfaced,
      expired: counters.expired,
      coalesced: counters.coalesced,
      errored,
    });
  }

  return {
    start(): void {
      if (!enabled) {
        logger.info(
          { intervalMs, killSwitchEnvFlag: SOMEDAY_REVIEW_KILL_SWITCH_ENV },
          'someday-review: disabled (no start)',
        );
        return;
      }
      if (timer) {
        logger.warn({}, 'someday-review: already running, ignoring duplicate start');
        return;
      }
      logger.info({ intervalMs }, 'someday-review: started');
      timer = setInterval(() => {
        void tickOnce();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickOnce,
  };
}
