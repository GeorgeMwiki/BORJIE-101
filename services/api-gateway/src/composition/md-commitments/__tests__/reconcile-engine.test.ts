/**
 * RECONCILE engine + ladder + close-loop tests — the DEFERRAL / FOLLOW-THROUGH
 * organ's never-drop-a-thread sweep.
 *
 * Covers (per the build directive):
 *   - defer → persist → reconcile RESURFACES when due (time + event);
 *   - an overdue SOVEREIGN obligation ESCALATES to the HITL safe-halt and NEVER
 *     auto-actuates;
 *   - an event trigger flips waiting_for → due on a ledger credit;
 *   - close-on-proof vs re-open (an acked-but-unconfirmed item re-opens, never
 *     silently closes);
 *   - reconcile is FAIL-SAFE — a store fault never breaks the tick;
 *   - the someday class is reviewed, never climbed up the intrusive ladder.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createInMemoryMdCommitmentRepository,
  type MdCommitmentRepository,
  type CreateMdCommitmentInput,
} from '@borjie/database/repositories';

import { createReconcileEngine, type ConfirmationProbe } from '../reconcile-engine.js';
import { createWaitForEventSubscriber } from '../wait-for.js';
import type { LadderDispatchers } from '../ladder-engine.js';

const T = 'tenant-A';

const NOOP_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof createReconcileEngine>[0]['logger'];

function recordingDispatchers(): {
  dispatchers: LadderDispatchers;
  calls: { rung: string; id: string }[];
} {
  const calls: { rung: string; id: string }[] = [];
  return {
    calls,
    dispatchers: {
      async inApp(c) {
        calls.push({ rung: 'inApp', id: c.id });
      },
      async email(c) {
        calls.push({ rung: 'email', id: c.id });
      },
      async sms(c) {
        calls.push({ rung: 'sms', id: c.id });
      },
      async ownerDirectSafeHalt(c) {
        calls.push({ rung: 'safeHalt', id: c.id });
      },
      async escalate(c) {
        calls.push({ rung: 'escalate', id: c.id });
      },
    },
  };
}

function recordingSink(): {
  sink: Parameters<typeof createReconcileEngine>[0]['proposalSink'];
  surfaced: string[];
} {
  const surfaced: string[] = [];
  return {
    surfaced,
    sink: {
      async propose(p) {
        surfaced.push(p.id);
        return true;
      },
    },
  };
}

function timeInput(
  dueAtMs: number,
  overrides: Partial<CreateMdCommitmentInput> = {},
): CreateMdCommitmentInput {
  return {
    tenantId: T,
    class: 'tickler',
    title: 'Renew PML',
    titleSw: 'Fanya upya leseni',
    rationale: 'The licence expires soon.',
    evidenceIds: ['evi-licence'],
    triggerKind: 'time',
    triggerSpec: { dueAt: new Date(dueAtMs).toISOString() },
    triggerDueAt: new Date(dueAtMs).toISOString(),
    idempotencyKey: `time-${dueAtMs}`,
    ...overrides,
  };
}

function eventInput(
  overrides: Partial<CreateMdCommitmentInput> = {},
): CreateMdCommitmentInput {
  return {
    tenantId: T,
    class: 'waiting_for',
    title: 'File royalty after settlement',
    titleSw: 'Wasilisha mrabaha baada ya malipo',
    rationale: 'Act on the royalty the moment the buyer money clears.',
    evidenceIds: ['evi-royalty'],
    triggerKind: 'event',
    triggerSpec: { eventKey: 'ledger.credit' },
    idempotencyKey: 'event-royalty',
    ...overrides,
  };
}

function build(repo: MdCommitmentRepository, extra: {
  confirmationProbe?: ConfirmationProbe | null;
} = {}) {
  const { dispatchers, calls } = recordingDispatchers();
  const { sink, surfaced } = recordingSink();
  const engine = createReconcileEngine({
    repo,
    proposalSink: sink,
    ladderDispatchers: dispatchers,
    confirmationProbe: extra.confirmationProbe ?? null,
    logger: NOOP_LOGGER,
  });
  return { engine, calls, surfaced };
}

describe('RECONCILE engine — defer → persist → resurface when due', () => {
  it('resurfaces a TIME commitment once its due time passes (rung 0 fires)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await repo.create(timeInput(1000));
    const { engine, calls, surfaced } = build(repo);

    // Before due — nothing fires.
    const early = await engine.reconcile({ tenantId: T, nowMs: 500 });
    expect(early.surfaced).toBe(0);
    expect(calls).toHaveLength(0);

    // After due — resurfaces + the first ladder rung (0=in-app) fires.
    const late = await engine.reconcile({ tenantId: T, nowMs: 2000 });
    expect(late.surfaced).toBe(1);
    expect(surfaced).toHaveLength(1);
    expect(calls[0]?.rung).toBe('inApp');
  });

  it('an event trigger flips waiting_for → due on a ledger credit', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const created = await repo.create(eventInput());
    expect(created.status).toBe('open');

    const subscriber = createWaitForEventSubscriber({ repo, logger: NOOP_LOGGER });
    const flipped = await subscriber.onEvent({
      tenantId: T,
      eventKey: 'ledger.credit',
    });
    expect(flipped).toBe(1);

    const after = await repo.get(T, created.id);
    expect(after?.status).toBe('overdue');

    // The reconcile sweep now resurfaces it.
    const { engine, surfaced } = build(repo);
    const res = await engine.reconcile({ tenantId: T, nowMs: 1000 });
    expect(res.surfaced).toBe(1);
    expect(surfaced).toContain(`commitment:${created.id}`);
  });

  it('the someday class is reviewed, never climbed up the intrusive ladder', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await repo.create(
      timeInput(1000, { class: 'someday', idempotencyKey: 'someday-1' }),
    );
    const { engine, calls, surfaced } = build(repo);
    const res = await engine.reconcile({ tenantId: T, nowMs: 2000 });
    // It surfaces for review but never fires a ladder rung.
    expect(res.surfaced).toBe(1);
    expect(surfaced).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe('RECONCILE engine — sovereign safe-halt (never auto-actuate)', () => {
  it('escalates an overdue SOVEREIGN obligation to the safe-halt, never auto-fires', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const c = await repo.create(
      timeInput(1000, {
        class: 'next_action',
        kind: 'royalty.filing',
        sovereign: true,
        idempotencyKey: 'sovereign-royalty',
      }),
    );
    const { engine, calls } = build(repo);

    // Climb the ladder across ticks; the SOVEREIGN tight cadence is 4h.
    let now = 2000;
    const step = 4 * 60 * 60 * 1000 + 1;
    for (let i = 0; i < 5; i += 1) {
      await engine.reconcile({ tenantId: T, nowMs: now });
      now += step;
    }

    // The safe-halt rung (3) and/or escalate (4) must have fired — and the
    // commitment is NEVER 'done' (no auto-actuation, no optimistic close).
    const fired = calls.map((x) => x.rung);
    expect(fired).toContain('safeHalt');
    const final = await repo.get(T, c.id);
    expect(final?.status).not.toBe('done');
    expect(final?.confirmedAtMs).toBeNull();
  });
});

describe('RECONCILE engine — close-on-proof vs re-open', () => {
  it('closes ONLY on positive proof', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const c = await repo.create(eventInput({ idempotencyKey: 'close-proof' }));
    // Simulate the item having been surfaced + acknowledged.
    await repo.transition(T, c.id, { status: 'overdue' });
    await repo.ack(T, c.id, new Date(1000));

    const probe: ConfirmationProbe = {
      async proofFor() {
        return 'ledger_entry';
      },
    };
    const { engine } = build(repo, { confirmationProbe: probe });
    const res = await engine.reconcile({ tenantId: T, nowMs: 2000 });
    expect(res.confirmed).toBe(1);

    const final = await repo.get(T, c.id);
    expect(final?.status).toBe('done');
    expect(final?.confirmationKind).toBe('ledger_entry');
  });

  it('RE-OPENS an acked-but-unconfirmed item past the confirmation deadline (never drops)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const c = await repo.create(eventInput({ idempotencyKey: 'reopen' }));
    await repo.transition(T, c.id, { status: 'overdue' });
    await repo.ack(T, c.id, new Date(1000));

    const noProof: ConfirmationProbe = {
      async proofFor() {
        return null; // the filing was never confirmed by the regulator
      },
    };
    const { engine } = build(repo, { confirmationProbe: noProof });
    // Past the 7-day confirmation deadline → re-open.
    const past = 1000 + 8 * 24 * 60 * 60 * 1000;
    const res = await engine.reconcile({ tenantId: T, nowMs: past });
    expect(res.reopened).toBe(1);

    const final = await repo.get(T, c.id);
    expect(final?.status).toBe('reopened');
    expect(final?.confirmedAtMs).toBeNull();
  });
});

describe('RECONCILE engine — fail-safe', () => {
  it('a store fault degrades the sweep, never throws (the tick is never broken)', async () => {
    const faulty: MdCommitmentRepository = {
      ...createInMemoryMdCommitmentRepository(),
      async listLive() {
        throw new Error('db down');
      },
    };
    const { engine } = build(faulty);
    const res = await engine.reconcile({ tenantId: T, nowMs: 1000 });
    expect(res.degradedReason).toBe('listLive-failed');
    expect(res.reviewed).toBe(0);
  });

  it('one pathological commitment never aborts the whole sweep', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await repo.create(timeInput(1000, { idempotencyKey: 'good' }));
    // A transition that throws for the one item — isolated, the sweep survives.
    const transitionSpy = vi
      .spyOn(repo, 'transition')
      .mockRejectedValueOnce(new Error('boom'));
    const { engine } = build(repo);
    const res = await engine.reconcile({ tenantId: T, nowMs: 2000 });
    expect(res.degradedReason).toBe('commitment-failed');
    transitionSpy.mockRestore();
  });
});
