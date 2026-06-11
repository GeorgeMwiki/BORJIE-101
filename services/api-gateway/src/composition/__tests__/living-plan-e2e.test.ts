/**
 * living-plan-e2e.test.ts — locks the LIVING-MD organ's felt-loop contract end
 * to end, over the in-memory commitment repository + in-memory leaf fakes:
 *
 *   1. FULL LIFECYCLE: defer → listLive → fire event (bus) → overdue →
 *      pre-turn re-read injects a context block → post-turn surfaces a
 *      commitment_state event → confirm → done → the state meter reflects it.
 *   2. SOMEDAY supervisor: a someday item is invisible to the chat lens, is
 *      resurfaced through the gated proposal sink on cadence (idempotent
 *      coalesce on a re-tick), and a >1yr item is expired (blocked) + notified.
 *   3. TURN HOOKS: the pre-turn block is single-language; the post-turn event
 *      fires only on a became-due diff; a sovereign newly-due item requests a
 *      safe-halt DRAFT (never auto-executes).
 *   4. EVENT BUS idempotency: a re-delivered (tenant, key, ts) never double-fires.
 *   5. KILL-SWITCH / test-env gate keeps the someday supervisor start() inert.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  createInMemoryMdCommitmentRepository,
  type CreateMdCommitmentInput,
  type MdCommitmentRepository,
} from '@borjie/database/repositories';
import { createWaitForEventSubscriber } from '../md-commitments/wait-for';
import { createLivingMdOrgan } from '../living-md/living-md-wiring';
import {
  SOMEDAY_REVIEW_KILL_SWITCH_ENV,
  createSomedayReviewSupervisor,
  isTenantDueForReview,
  type ProposalSinkLike,
  type SomedayProposalLike,
} from '../living-md/someday-review-supervisor';
import { buildContextBlock } from '../living-md/turn-commitment-hooks';
import { createCommitmentStatePort } from '../living-md/commitment-state-port';
import type { PinoLikeLogger } from '../../utils/pino-shim';

const TENANT = 'tenant-A';

const silentLogger: PinoLikeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function deferInput(
  overrides: Partial<CreateMdCommitmentInput> = {},
): CreateMdCommitmentInput {
  return {
    tenantId: TENANT,
    class: 'waiting_for',
    kind: 'royalty.filing',
    title: 'File royalty after settlement lands',
    titleSw: 'Wasilisha mrabaha baada ya malipo kuingia',
    rationale: 'The buyer settlement clears the filing amount.',
    evidenceIds: ['evi-1'],
    triggerKind: 'event',
    triggerSpec: { eventKey: 'ledger.credit' },
    idempotencyKey: 'idem-royalty',
    ...overrides,
  };
}

/** A capturing proposal sink with the idempotent coalesce semantics. */
function makeCapturingSink(): ProposalSinkLike & {
  readonly captured: SomedayProposalLike[];
} {
  const captured: SomedayProposalLike[] = [];
  const pending = new Set<string>();
  return {
    captured,
    async propose(p: SomedayProposalLike): Promise<boolean> {
      const key = `${p.tenantId}:${p.id}`;
      if (pending.has(key)) return false; // already pending → coalesce
      pending.add(key);
      captured.push(p);
      return true;
    },
  };
}

function buildOrgan(
  repo: MdCommitmentRepository,
  proposalSink: ProposalSinkLike | null,
  clock: () => Date,
) {
  const eventSubscriber = createWaitForEventSubscriber({
    repo,
    logger: silentLogger,
  });
  return createLivingMdOrgan({
    repository: repo,
    eventSubscriber,
    proposalSink,
    listActiveTenantIds: async () => [TENANT],
    db: null, // timeline + governance degrade to safe no-ops / defaults
    logger: silentLogger,
    clock,
    somedayEnabled: false, // never auto-start the cron in tests
  });
}

describe('LIVING-MD organ — full felt-loop lifecycle', () => {
  let repo: MdCommitmentRepository;
  let now: number;
  const clock = () => new Date(now);

  beforeEach(() => {
    repo = createInMemoryMdCommitmentRepository();
    now = 1_000_000;
  });

  it('defer → event flip → overdue → pre/post-turn → confirm → done → meter', async () => {
    const organ = buildOrgan(repo, makeCapturingSink(), clock);

    // 1. DEFER — a waiting_for commitment is born open.
    const created = await repo.create(deferInput());
    expect(created.status).toBe('open');

    // listLive shows the open thread.
    const live1 = await repo.listLive(TENANT);
    expect(live1).toHaveLength(1);

    // 2. FIRE the event through the injected bus → flips waiting → overdue.
    const flipped = await organ.mdEventBus.emit('ledger.credit', {
      tenantId: TENANT,
      occurredAtMs: now,
    });
    expect(flipped).toBe(1);
    const afterFlip = await repo.get(TENANT, created.id);
    expect(afterFlip?.status).toBe('overdue');

    // 3. PRE-TURN re-read sees the overdue backlog and builds a context block.
    const pre = await organ.turnHooks.preTurn({
      tenantId: TENANT,
      language: 'en',
      lastTurnAtMs: now - 60_000,
    });
    expect(pre.state?.counts.overdue).toBe(1);
    expect(pre.contextBlock).toBeTruthy();
    expect(pre.contextBlock).toContain('overdue');

    // 4. POST-TURN surfaces a commitment_state event for the became-due item.
    const post = await organ.turnHooks.postTurn({
      tenantId: TENANT,
      language: 'en',
      lastTurnAtMs: now - 60_000,
    });
    expect(post.event).not.toBeNull();
    expect(post.event?.type).toBe('commitment_state');
    expect(post.event?.becameDue.map((b) => b.id)).toContain(created.id);

    // 5. CONFIRM — close ONLY on positive proof.
    const done = await repo.markDone(TENANT, created.id, {
      confirmationKind: 'regulator_ack',
    });
    expect(done?.status).toBe('done');
    expect(done?.confirmationKind).toBe('regulator_ack');

    // 6. METER — the state port no longer counts it as overdue/live.
    const state = await organ.commitmentStatePort.getState(TENANT, 0);
    expect(state.counts.overdue).toBe(0);
    expect(state.deferredCount).toBe(0);
  });

  it('event bus dedupes a re-delivered (tenant, key, ts) — no double-flip', async () => {
    const organ = buildOrgan(repo, null, clock);
    await repo.create(deferInput());

    const first = await organ.mdEventBus.emit('ledger.credit', {
      tenantId: TENANT,
      occurredAtMs: now,
    });
    expect(first).toBe(1);
    // Same key within the dedupe window → dropped (0), no re-flip storm.
    const second = await organ.mdEventBus.emit('ledger.credit', {
      tenantId: TENANT,
      occurredAtMs: now,
    });
    expect(second).toBe(0);
  });

  it('someday items are invisible to the chat lens but counted', async () => {
    await repo.create(
      deferInput({
        class: 'someday',
        triggerKind: 'condition',
        triggerSpec: { predicate: { horizon: 'long' } },
        idempotencyKey: 'idem-someday',
      }),
    );
    const port = createCommitmentStatePort({ repository: repo, clock });
    const state = await port.getState(TENANT, 0);
    // Excluded from open/due/nextActions; only counted in somedayCount.
    expect(state.somedayCount).toBe(1);
    expect(state.counts.open).toBe(0);
    expect(state.nextActions).toHaveLength(0);
    expect(state.deferredCount).toBe(0);
  });
});

describe('LIVING-MD — someday-review supervisor', () => {
  let repo: MdCommitmentRepository;
  let now: number;
  const clock = () => new Date(now);

  beforeEach(() => {
    repo = createInMemoryMdCommitmentRepository();
    // Anchor on the real clock: the in-memory repo stamps createdAt at wall
    // time, so the supervisor's age math (now − createdAt) must share that base.
    now = Date.now();
  });

  function makeSupervisor(sink: ProposalSinkLike | null, enabled = false) {
    return createSomedayReviewSupervisor({
      repository: repo,
      governanceStore: {
        async read() {
          return {
            autonomyCap: 'delegate',
            somedayReviewCadenceDays: 7,
            evidenceRequirementEnforced: true,
            confirmationProbeMappings: {},
          };
        },
        async upsert() {
          return {
            autonomyCap: 'delegate',
            somedayReviewCadenceDays: 7,
            evidenceRequirementEnforced: true,
            confirmationProbeMappings: {},
          };
        },
      },
      proposalSink: sink,
      timelineSink: null,
      listActiveTenantIds: async () => [TENANT],
      logger: silentLogger,
      clock,
      enabled,
    });
  }

  it('resurfaces a fresh someday item through the gated sink; re-tick coalesces', async () => {
    await repo.create(
      deferInput({
        class: 'someday',
        triggerKind: 'condition',
        triggerSpec: { predicate: { horizon: 'long' } },
        idempotencyKey: 'idem-someday',
        // created "now" so it is within the 1yr horizon.
      }),
    );
    const sink = makeCapturingSink();
    const supervisor = makeSupervisor(sink);

    const tick1 = await supervisor.tickOnce();
    expect(tick1.resurfaced).toBe(1);
    expect(sink.captured).toHaveLength(1);
    expect(sink.captured[0]?.id).toContain('someday-review:');

    // A re-tick within the same cadence: the cadence gate suppresses re-work,
    // and even if it surfaced the sink would coalesce (idempotent). Either way
    // no second proposal is captured.
    const tick2 = await supervisor.tickOnce();
    expect(tick2.resurfaced).toBe(0);
    expect(sink.captured).toHaveLength(1);
  });

  it('expires a someday item parked over a year (blocked + owner-notified)', async () => {
    // Seed the item at the real wall-clock createdAt the in-memory repo stamps,
    // then advance the supervisor's clock >1yr so age (now − createdAt) expires.
    const item = await repo.create(
      deferInput({
        class: 'someday',
        triggerKind: 'condition',
        triggerSpec: { predicate: { horizon: 'long' } },
        idempotencyKey: 'idem-old-someday',
      }),
    );
    now = Date.now() + 366 * 24 * 60 * 60 * 1000;

    const sink = makeCapturingSink();
    const supervisor = makeSupervisor(sink);
    const tick = await supervisor.tickOnce();
    expect(tick.expired).toBe(1);

    const after = await repo.get(TENANT, item.id);
    expect(after?.status).toBe('blocked');
    // An expiry proposal was surfaced to the owner.
    expect(sink.captured.some((p) => p.title.includes('expired'))).toBe(true);
  });

  it('never expires an item the owner was NOT notified about (surfaced gate)', async () => {
    // The RLS-dead regression: the gated sink's propose() returned false on
    // every call (FORCE-RLS denied the tab_event_log INSERT), yet the
    // supervisor still expired (blocked) >1yr items — vanishing them without
    // the owner ever seeing the notice. The gate: no surfaced notice → no
    // expiry; the item stays live and is re-attempted next tick.
    const item = await repo.create(
      deferInput({
        class: 'someday',
        triggerKind: 'condition',
        triggerSpec: { predicate: { horizon: 'long' } },
        idempotencyKey: 'idem-unsurfaced-someday',
      }),
    );
    now = Date.now() + 366 * 24 * 60 * 60 * 1000;

    // A sink whose surfacing path is dead (the RLS-dead propose() shape).
    const deadSink: ProposalSinkLike = { propose: async () => false };
    const supervisor = makeSupervisor(deadSink);
    const tick = await supervisor.tickOnce();

    expect(tick.expired).toBe(0);
    expect(tick.coalesced).toBe(1);
    const after = await repo.get(TENANT, item.id);
    // NOT blocked — still live, invisible-vanish is impossible.
    expect(after?.status).not.toBe('blocked');
    const live = await repo.listLive(TENANT);
    expect(live.map((c) => c.id)).toContain(item.id);
  });

  it('start() is INERT under the test-env / kill-switch gate', () => {
    const supervisor = createSomedayReviewSupervisor({
      repository: repo,
      governanceStore: {
        async read() {
          return {
            autonomyCap: 'delegate',
            somedayReviewCadenceDays: 7,
            evidenceRequirementEnforced: true,
            confirmationProbeMappings: {},
          };
        },
        async upsert() {
          return {
            autonomyCap: 'delegate',
            somedayReviewCadenceDays: 7,
            evidenceRequirementEnforced: true,
            confirmationProbeMappings: {},
          };
        },
      },
      proposalSink: makeCapturingSink(),
      listActiveTenantIds: async () => [TENANT],
      logger: silentLogger,
      env: { NODE_ENV: 'test' },
    });
    // No throw, no interval scheduled — start() is a no-op under the gate.
    expect(() => supervisor.start()).not.toThrow();
    expect(() => supervisor.stop()).not.toThrow();
    expect(SOMEDAY_REVIEW_KILL_SWITCH_ENV).toBe('BORJIE_SOMEDAY_REVIEW');
  });

  it('isTenantDueForReview honours the cadence', () => {
    const nowMs = 1_000_000_000_000;
    expect(isTenantDueForReview(null, 7, nowMs)).toBe(true);
    expect(
      isTenantDueForReview(nowMs - 8 * 24 * 60 * 60 * 1000, 7, nowMs),
    ).toBe(true);
    expect(
      isTenantDueForReview(nowMs - 1 * 24 * 60 * 60 * 1000, 7, nowMs),
    ).toBe(false);
  });
});

describe('LIVING-MD — turn-hook context block + sovereign draft', () => {
  it('buildContextBlock is single-language EN, no SW leakage', () => {
    const block = buildContextBlock(
      {
        tenantId: TENANT,
        counts: { open: 1, scheduled: 0, due: 1, overdue: 1, blocked: 0 },
        somedayCount: 0,
        deferredCount: 2,
        nextDueAtMs: null,
        becameDueSince: [
          {
            id: 'c1',
            title: 'Royalty filing',
            titleSw: 'Uwasilishaji wa mrabaha',
            kind: 'royalty.filing',
            status: 'overdue',
            sovereign: true,
            triggerDueAtMs: null,
            rungLevel: 0,
            evidenceIds: ['evi-1'],
          },
        ],
        newSince: [],
        staleOverdue: [],
        nextActions: [],
      },
      'en',
    );
    expect(block).toBeTruthy();
    expect(block).toContain('Royalty filing');
    // ABSOLUTE single-language: no Swahili title leaks into the EN block.
    expect(block).not.toContain('mrabaha');
  });

  it('buildContextBlock renders Swahili-only when locale=sw', () => {
    const block = buildContextBlock(
      {
        tenantId: TENANT,
        counts: { open: 0, scheduled: 0, due: 1, overdue: 1, blocked: 0 },
        somedayCount: 0,
        deferredCount: 1,
        nextDueAtMs: null,
        becameDueSince: [
          {
            id: 'c1',
            title: 'Royalty filing',
            titleSw: 'Uwasilishaji wa mrabaha',
            kind: 'royalty.filing',
            status: 'overdue',
            sovereign: false,
            triggerDueAtMs: null,
            rungLevel: 0,
            evidenceIds: ['evi-1'],
          },
        ],
        newSince: [],
        staleOverdue: [],
        nextActions: [],
      },
      'sw',
    );
    expect(block).toBeTruthy();
    expect(block).toContain('mrabaha');
    // No English title leaks into the SW block.
    expect(block).not.toContain('Royalty filing');
  });

  it('returns null when the backlog is calm (no noise in the prompt)', () => {
    const block = buildContextBlock(
      {
        tenantId: TENANT,
        counts: { open: 0, scheduled: 2, due: 0, overdue: 0, blocked: 0 },
        somedayCount: 3,
        deferredCount: 2,
        nextDueAtMs: 1234,
        becameDueSince: [],
        newSince: [],
        staleOverdue: [],
        nextActions: [],
      },
      'en',
    );
    expect(block).toBeNull();
  });
});
