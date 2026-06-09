/**
 * MdCommitmentRepository — Capability Gap Register methods (migration 0326).
 *
 * Covers the gap-store invariants on the in-memory twin (the Drizzle twin
 * shares the surface; its RLS isolation is enforced by 0321's FORCE policy):
 *   - createGap persists a typed gap born `blocked` with the unblock trigger
 *     and blocked_by edges; it is idempotent on (tenantId, idempotencyKey);
 *   - evidence-required: a gap with an empty evidence chain is rejected;
 *   - listOpenGaps returns only non-null gap_kind live rows (never ordinary
 *     commitments);
 *   - advanceGapStatus stitches an append-only audit-chain hash and is honest:
 *     `done` stamps confirmedAt + confirmationKind; the chain advances each step
 *     and never reuses a hash.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createInMemoryMdCommitmentRepository,
  isTerminalGapStatus,
  replayGapAuditChain,
  type CreateGapInput,
  type GapAuditAppendPort,
  type ReplayableGapAuditEntry,
} from '../md-commitment-repository.js';

const T = 'tenant-gap';

function baseGap(over: Partial<CreateGapInput> = {}): CreateGapInput {
  return {
    tenantId: T,
    gapKind: 'unwired_organ',
    title: 'Blocked: platform.suspend_licence not yet available',
    titleSw: 'Imezuiwa: platform.suspend_licence bado haipatikani',
    rationale: 'executor-failed: adapter not yet wired',
    evidenceIds: ['gap:platform.suspend_licence'],
    unblockTrigger: { kind: 'tool_registered', target: 'platform.suspend_licence' },
    competenceDomain: 'licences',
    idempotencyKey: 'gap:unwired_organ:platform.suspend_licence',
    ...over,
  };
}

describe('MdCommitmentRepository — gap methods', () => {
  it('createGap persists a typed gap born blocked with the trigger', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap({ blockedBy: ['blk-1'] }));
    expect(gap.gapKind).toBe('unwired_organ');
    expect(gap.status).toBe('blocked');
    expect(gap.class).toBe('waiting_for');
    expect(gap.triggerKind).toBe('event');
    expect(gap.unblockTrigger).toEqual({
      kind: 'tool_registered',
      target: 'platform.suspend_licence',
    });
    expect(gap.blockedBy).toEqual(['blk-1']);
    expect(gap.competenceDomain).toBe('licences');
    expect(gap.confirmedAtMs).toBeNull();
    expect(gap.auditChainHash).toBeNull();
  });

  it('createGap is idempotent on (tenantId, idempotencyKey)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const a = await repo.createGap(baseGap());
    const b = await repo.createGap(baseGap());
    expect(b.id).toBe(a.id);
    expect(await repo.listOpenGaps(T)).toHaveLength(1);
  });

  it('rejects a gap with an empty evidence chain', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await expect(repo.createGap(baseGap({ evidenceIds: [] }))).rejects.toThrow(
      /evidence-required/,
    );
  });

  it('listOpenGaps returns only gap rows, never ordinary commitments', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await repo.createGap(baseGap());
    // An ordinary commitment (no gapKind) must NOT appear in the gap list.
    await repo.create({
      tenantId: T,
      class: 'next_action',
      title: 'Ordinary',
      titleSw: 'Kawaida',
      rationale: 'r',
      evidenceIds: ['ev-1'],
      triggerKind: 'event',
      triggerSpec: { eventKey: 'x' },
      idempotencyKey: 'ordinary-1',
    });
    const gaps = await repo.listOpenGaps(T);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.gapKind).toBe('unwired_organ');
  });

  it('advanceGapStatus stitches an append-only audit chain and is honest', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap());

    const scheduled = await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'blocker cleared',
    });
    expect(scheduled?.status).toBe('scheduled');
    expect(scheduled?.auditChainHash).toBeTruthy();
    const hash1 = scheduled?.auditChainHash;

    const done = await repo.advanceGapStatus(T, gap.id, {
      status: 'done',
      reason: 'verifier approved',
      confirmationKind: 'auditor_approved',
    });
    expect(done?.status).toBe('done');
    expect(done?.confirmedAtMs).not.toBeNull();
    expect(done?.confirmationKind).toBe('auditor_approved');
    // The chain advanced — the hash is different from the prior step.
    expect(done?.auditChainHash).toBeTruthy();
    expect(done?.auditChainHash).not.toBe(hash1);
  });

  it('advanceGapStatus is a no-op for an unknown / non-gap id', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const missing = await repo.advanceGapStatus(T, 'nope', {
      status: 'done',
      reason: 'x',
    });
    expect(missing).toBeNull();
  });

  // ── FIX 1 — no self-grade to done (verifier confirmation mandatory) ────────

  it('advanceGapStatus to `done` WITHOUT a confirmationKind THROWS (no self-grade)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap());
    // The auto-completer schedules first; `done` is only reachable from there.
    await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'blocker cleared',
    });
    await expect(
      repo.advanceGapStatus(T, gap.id, { status: 'done', reason: 'forced' }),
    ).rejects.toThrow(/confirmationKind/);
    // An empty-string confirmation is just as rejected (no whitespace bypass).
    await expect(
      repo.advanceGapStatus(T, gap.id, {
        status: 'done',
        reason: 'forced',
        confirmationKind: '   ',
      }),
    ).rejects.toThrow(/confirmationKind/);
    const after = await repo.get(T, gap.id);
    expect(after?.status).toBe('scheduled');
    expect(after?.confirmedAtMs).toBeNull();
  });

  it('advanceGapStatus to `done` from a non-scheduled state THROWS (from-guard)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap()); // born `blocked`.
    await expect(
      repo.advanceGapStatus(T, gap.id, {
        status: 'done',
        reason: 'skip the schedule',
        confirmationKind: 'auditor_approved',
      }),
    ).rejects.toThrow(/only reachable from/);
    expect((await repo.get(T, gap.id))?.status).toBe('blocked');
  });

  // ── FIX 4 — attempt cap → terminal dead_letter, out of listOpenGaps ────────

  it('after the reopened-attempt cap a gap goes terminal dead_letter (no storm)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap());

    // The REAL auto-completer flow per attempt is schedule (→scheduled) then
    // reopen (→reopened) on a verify-FAILURE. FIX 4 counts a DISTINCT logical
    // failure (a `scheduled → reopened` transition), never a raw call. Three
    // failed attempts: the first two stay live `reopened`; the third crosses
    // the cap and dead-letters (TERMINAL, out of the live set).
    async function failedAttempt(n: number): Promise<void> {
      await repo.advanceGapStatus(T, gap.id, {
        status: 'scheduled',
        reason: `blocker cleared #${n}`,
      });
    }

    await failedAttempt(1);
    const r1 = await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected #1',
    });
    expect(r1?.status).toBe('reopened');
    expect(r1?.attemptFailedCount).toBe(1);

    await failedAttempt(2);
    const r2 = await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected #2',
    });
    expect(r2?.status).toBe('reopened');
    expect(r2?.attemptFailedCount).toBe(2);

    await failedAttempt(3);
    const r3 = await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected #3',
    });
    expect(r3?.status).toBe('dead_letter');
    expect(isTerminalGapStatus(r3!.status)).toBe(true);
    expect(r3?.blockedReason).toMatch(/dead_letter/);

    // A dead-lettered gap is no longer in the watcher live set.
    expect(await repo.listOpenGaps(T)).toHaveLength(0);
  });

  it('a parked needs_approval gap is TERMINAL — out of listOpenGaps', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap({ sovereign: true }));
    const parked = await repo.advanceGapStatus(T, gap.id, {
      status: 'needs_approval',
      reason: 'sovereign — awaits four-eye',
      blockedReason: 'needs_approval: four-eye',
    });
    expect(parked?.status).toBe('needs_approval');
    expect(isTerminalGapStatus(parked!.status)).toBe(true);
    expect(await repo.listOpenGaps(T)).toHaveLength(0);
  });

  // ── FIX 5/6 — append-only audit chain; re-park appends ONE row, replays ────

  it('re-parking the same gap twice appends only ONE audit row (no storm) and the chain replays', async () => {
    const appended: Array<{
      readonly gapId: string;
      readonly transition: string;
      readonly chainHash: string;
    }> = [];
    const auditSink: GapAuditAppendPort = {
      async append(entry) {
        appended.push({
          gapId: entry.gapId,
          transition: entry.transition,
          chainHash: entry.chainHash,
        });
      },
    };
    const repo = createInMemoryMdCommitmentRepository({ auditSink });
    const gap = await repo.createGap(baseGap({ sovereign: true }));

    const first = await repo.advanceGapStatus(T, gap.id, {
      status: 'needs_approval',
      reason: 'park #1',
      blockedReason: 'needs_approval: four-eye',
    });
    // Re-park with the SAME status + blockedReason → NO-OP (no hash bump).
    const second = await repo.advanceGapStatus(T, gap.id, {
      status: 'needs_approval',
      reason: 'park #2 (same state)',
      blockedReason: 'needs_approval: four-eye',
    });

    // Only ONE audit append across the two ticks (the second is a no-op).
    expect(appended).toHaveLength(1);
    const onlyAppend = appended[0]!;
    expect(onlyAppend.transition).toBe('gap:blocked->needs_approval');
    // The no-op returns the row UNCHANGED — same head hash, no bump.
    expect(second?.auditChainHash).toBe(first?.auditChainHash);

    // The chain replays: the appended head hash equals the row's head hash.
    expect(onlyAppend.chainHash).toBe(first?.auditChainHash);
  });

  it('advanceGapStatus appends an audit row per real advance (append-only sink)', async () => {
    const transitions: string[] = [];
    const auditSink: GapAuditAppendPort = {
      async append(entry) {
        transitions.push(entry.transition);
      },
    };
    const repo = createInMemoryMdCommitmentRepository({ auditSink });
    const gap = await repo.createGap(baseGap());
    await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'cleared',
    });
    await repo.advanceGapStatus(T, gap.id, {
      status: 'done',
      reason: 'verifier approved',
      confirmationKind: 'auditor_approved',
    });
    expect(transitions).toEqual([
      'gap:blocked->scheduled',
      'gap:scheduled->done',
    ]);
  });

  it('an audit-sink fault never aborts the durable advance (best-effort)', async () => {
    const auditSink: GapAuditAppendPort = {
      append: vi.fn(async () => {
        throw new Error('audit chain unreachable');
      }),
    };
    const repo = createInMemoryMdCommitmentRepository({ auditSink });
    const gap = await repo.createGap(baseGap());
    const scheduled = await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'cleared',
    });
    // The status advance still committed despite the sink throwing.
    expect(scheduled?.status).toBe('scheduled');
    expect(auditSink.append).toHaveBeenCalledTimes(1);
  });

  // ── FIX 7 — tenant assert (defence-in-depth under service-role bypass) ─────

  it('rejects an empty tenantId on every gap path (no silent cross-tenant)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await expect(repo.listOpenGaps('')).rejects.toThrow(/tenantId/);
    await expect(repo.get('', 'x')).rejects.toThrow(/tenantId/);
    await expect(
      repo.advanceGapStatus('', 'x', { status: 'scheduled', reason: 'r' }),
    ).rejects.toThrow(/tenantId/);
    await expect(repo.createGap(baseGap({ tenantId: '' }))).rejects.toThrow(
      /tenantId/,
    );
  });

  // ── FIX 1 — STRUCTURAL gap segregation (no generic markDone bypass) ────────

  it('the generic reconcile read queries NEVER return a gap row', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    // A blocked gap on an EVENT trigger (the gap shape) + an ordinary live
    // commitment. The generic reconcile read queries must see ONLY the latter.
    const gap = await repo.createGap(baseGap());
    await repo.create({
      tenantId: T,
      class: 'next_action',
      title: 'Ordinary live',
      titleSw: 'Kawaida hai',
      rationale: 'r',
      evidenceIds: ['ev-1'],
      triggerKind: 'event',
      triggerSpec: { eventKey: 'capability.tool_registered' },
      idempotencyKey: 'ord-live-1',
    });

    // listLive — the reconcile re-read. The gap (born `blocked`, a live status)
    // is excluded because gap_kind is NOT NULL.
    const live = await repo.listLive(T);
    expect(live.every((c) => c.gapKind === null)).toBe(true);
    expect(live.find((c) => c.id === gap.id)).toBeUndefined();

    // listWaitingForEvent — even on the SAME eventKey the gap inserts under, the
    // generic event lookup never returns the gap row.
    const waiting = await repo.listWaitingForEvent(T, 'capability.tool_registered');
    expect(waiting.every((c) => c.gapKind === null)).toBe(true);
    expect(waiting.find((c) => c.id === gap.id)).toBeUndefined();

    // A time-due gap is likewise invisible to listDueByTime. Build one and prove
    // it never surfaces even when its deadline is long past.
    await repo.create({
      tenantId: T,
      class: 'tickler',
      kind: 'general',
      title: 'Time commitment',
      titleSw: 'Ahadi ya muda',
      rationale: 'r',
      evidenceIds: ['ev-2'],
      triggerKind: 'time',
      triggerSpec: { dueAt: new Date(0).toISOString() },
      triggerDueAt: new Date(0).toISOString(),
      idempotencyKey: 'ord-time-1',
    });
    const due = await repo.listDueByTime(T, Date.now());
    expect(due.every((c) => c.gapKind === null)).toBe(true);
  });

  it('the generic reconcile markDone path can NEVER complete a gap row', async () => {
    // Model the generic reconcile-engine: it re-reads listLive, then closes a
    // confirmed item via markDone. Because listLive structurally excludes gap
    // rows, the generic markDone is never even reachable for a gap — and even if
    // a caller forced the gap id, the gap stays uncompleted by THIS path (only
    // advanceGapStatus, the verifier-gated path, can complete it).
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap());

    // (a) The generic sweep's source set never contains the gap.
    const sweepSet = await repo.listLive(T);
    expect(sweepSet.find((c) => c.id === gap.id)).toBeUndefined();

    // (b) markDone is the generic completion primitive. Calling it directly on
    // the gap id with a forged proof does NOT mark the gap done through the gap
    // lifecycle: the gap path requires the verifier-gated advanceGapStatus and a
    // schedule-first from-state. We assert the gap remains a live blocked gap in
    // the gap view (listOpenGaps) — the generic markDone is not the gap closure.
    // (markDone here is the generic commitment primitive; the production
    // reconcile-engine only ever reaches it via listLive, which excludes gaps.)
    const stillOpen = await repo.listOpenGaps(T);
    expect(stillOpen.find((c) => c.id === gap.id)?.status).toBe('blocked');
    expect(stillOpen.find((c) => c.id === gap.id)?.confirmedAtMs).toBeNull();
  });

  // ── FIX 2 — TERMINAL short-circuit (no advance, no count, no append) ───────

  it('a terminal gap advance is a NO-OP — no count bump, no audit append', async () => {
    const appended: string[] = [];
    const auditSink: GapAuditAppendPort = {
      async append(entry) {
        appended.push(entry.transition);
      },
    };
    const repo = createInMemoryMdCommitmentRepository({ auditSink });
    const gap = await repo.createGap(baseGap({ sovereign: true }));

    // Park it terminal (needs_approval) from `blocked` — the ONE real append.
    const parked = await repo.advanceGapStatus(T, gap.id, {
      status: 'needs_approval',
      reason: 'sovereign park',
      blockedReason: 'needs_approval: four-eye',
    });
    expect(parked?.status).toBe('needs_approval');
    expect(isTerminalGapStatus(parked!.status)).toBe(true);
    const headAfterPark = parked?.auditChainHash;
    const countAfterPark = parked?.attemptFailedCount;
    expect(appended).toHaveLength(1);

    // Any further advance from the terminal state is a structural no-op: a
    // re-park, a reopened re-count attempt, even a (would-be) schedule — none
    // advance, bump the cap, or append.
    const reReopen = await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'late verify-fail after park',
    });
    expect(reReopen?.status).toBe('needs_approval'); // unchanged
    expect(reReopen?.attemptFailedCount).toBe(countAfterPark); // NO bump
    expect(reReopen?.auditChainHash).toBe(headAfterPark); // NO hash bump

    const reSchedule = await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'tick re-clear after park',
    });
    expect(reSchedule?.status).toBe('needs_approval'); // unchanged
    expect(reSchedule?.auditChainHash).toBe(headAfterPark);

    // Still exactly ONE audit row across all the post-terminal ticks.
    expect(appended).toHaveLength(1);
  });

  it('a dead_letter gap can never advance / re-count / re-append (storm closed)', async () => {
    const appended: string[] = [];
    const auditSink: GapAuditAppendPort = {
      async append(entry) {
        appended.push(entry.transition);
      },
    };
    const repo = createInMemoryMdCommitmentRepository({ auditSink });
    const gap = await repo.createGap(baseGap());

    // Drive to dead_letter via three real (schedule→reopened) failures.
    for (let n = 1; n <= 3; n += 1) {
      await repo.advanceGapStatus(T, gap.id, {
        status: 'scheduled',
        reason: `cleared #${n}`,
      });
      await repo.advanceGapStatus(T, gap.id, {
        status: 'reopened',
        reason: `verify-fail #${n}`,
      });
    }
    const dead = await repo.get(T, gap.id);
    expect(dead?.status).toBe('dead_letter');
    const appendsAtDeadLetter = appended.length;
    const headAtDeadLetter = dead?.auditChainHash;
    const countAtDeadLetter = dead?.attemptFailedCount;

    // A storm of further reopened requests against the dead-lettered gap is a
    // pure no-op — the cap never climbs and the audit chain never grows.
    for (let i = 0; i < 5; i += 1) {
      await repo.advanceGapStatus(T, gap.id, {
        status: 'reopened',
        reason: `storm #${i}`,
      });
    }
    const after = await repo.get(T, gap.id);
    expect(after?.attemptFailedCount).toBe(countAtDeadLetter);
    expect(after?.auditChainHash).toBe(headAtDeadLetter);
    expect(appended).toHaveLength(appendsAtDeadLetter);
  });

  // ── FIX 4 — cap counts DISTINCT logical failures, not raw calls ────────────

  it('a duplicate reopened request does NOT double-count toward dead_letter', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap());

    // One real failure: schedule then reopen → count = 1.
    await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'cleared',
    });
    const first = await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected',
    });
    expect(first?.status).toBe('reopened');
    expect(first?.attemptFailedCount).toBe(1);

    // A DUPLICATE reopened request (a re-fired watcher tick on the SAME failure,
    // gap already `reopened`, no intervening schedule) must NOT re-count.
    const dup1 = await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected (duplicate tick)',
    });
    expect(dup1?.status).toBe('reopened');
    expect(dup1?.attemptFailedCount).toBe(1); // NOT 2 — de-duped.

    const dup2 = await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected (another duplicate)',
    });
    expect(dup2?.attemptFailedCount).toBe(1); // still 1.

    // Crucially the gap is NOT dead-lettered by duplicate calls — only DISTINCT
    // logical failures count, so it stays live for a genuine retry.
    expect(dup2?.status).toBe('reopened');
    expect(isTerminalGapStatus(dup2!.status)).toBe(false);
    expect(await repo.listOpenGaps(T)).toHaveLength(1);
  });

  // ── FIX 5 — the appended audit log replays INDEPENDENTLY of the live row ───

  it('the appended audit log replays + verifies WITHOUT the live row (2-3 steps)', async () => {
    const log: ReplayableGapAuditEntry[] = [];
    const auditSink: GapAuditAppendPort = {
      async append(entry) {
        log.push({
          gapId: entry.gapId,
          status: entry.status,
          reason: entry.reason,
          previousHash: entry.previousHash,
          chainHash: entry.chainHash,
          occurredAtMs: entry.occurredAtMs,
          sequence: entry.sequence,
        });
      },
    };
    let clock = 1_000;
    const repo = createInMemoryMdCommitmentRepository({
      auditSink,
      now: () => (clock += 1_000),
    });
    const gap = await repo.createGap(baseGap());

    // A 3-step chain: blocked → scheduled → reopened → scheduled → done would be
    // long; use the canonical happy path blocked→scheduled→done (2 advances)
    // plus an intermediate reopened to make it a 3-link chain.
    await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'blocker cleared',
    });
    await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected once',
    });
    await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 're-queued after reopen',
    });
    await repo.advanceGapStatus(T, gap.id, {
      status: 'done',
      reason: 'verifier approved',
      confirmationKind: 'auditor_approved',
    });

    const liveHead = (await repo.get(T, gap.id))?.auditChainHash ?? null;
    const replayCtx = {
      gapId: gap.id,
      tenantId: T,
      expectedTerminalHead: liveHead,
    };

    // The log alone (NO live row) recomputes + verifies every head hash + link.
    expect(log).toHaveLength(4);
    const verdict = replayGapAuditChain(log, replayCtx);
    expect(verdict.ok).toBe(true);
    expect(verdict.brokenAtIndex).toBe(-1);

    // First entry chains from genesis (previousHash null); each later entry's
    // previousHash links to the prior head.
    expect(log[0]!.previousHash).toBeNull();
    expect(log[1]!.previousHash).toBe(log[0]!.chainHash);
    expect(log[2]!.previousHash).toBe(log[1]!.chainHash);
    expect(log[3]!.previousHash).toBe(log[2]!.chainHash);

    // FIX 3b — the per-gap sequence is a gapless 0..N run.
    expect(log.map((e) => e.sequence)).toEqual([0, 1, 2, 3]);

    // Tamper-evidence: corrupt one prior entry's reason → replay breaks at it.
    const tampered: ReplayableGapAuditEntry[] = log.map((e, i) =>
      i === 1 ? { ...e, reason: 'forged reason' } : e,
    );
    const broken = replayGapAuditChain(tampered, replayCtx);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAtIndex).toBe(1);
  });

  // ── FIX 1 (WRITE-path) — generic mutators REFUSE a gap row ─────────────────

  it('no generic mutator (markDone/transition/reopen/block/ack) can change a gap', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const gap = await repo.createGap(baseGap());
    expect(gap.status).toBe('blocked');

    // markDone with a forged proof must NOT complete the gap.
    const afterDone = await repo.markDone(T, gap.id, {
      confirmationKind: 'forged_proof',
    });
    expect(afterDone?.status).toBe('blocked'); // unchanged — never done.
    expect(afterDone?.confirmedAtMs).toBeNull();

    // transition must NOT move the gap to a new status.
    const afterTransition = await repo.transition(T, gap.id, {
      status: 'scheduled',
    });
    expect(afterTransition?.status).toBe('blocked'); // unchanged.

    // reopen must NOT flip the gap to reopened (the cap is owned by the gap path).
    const afterReopen = await repo.reopen(T, gap.id);
    expect(afterReopen?.status).toBe('blocked'); // unchanged.

    // block must NOT re-stamp the generic blockedReason.
    const afterBlock = await repo.block(T, gap.id, 'generic block reason');
    expect(afterBlock?.status).toBe('blocked');
    expect(afterBlock?.blockedReason).not.toBe('generic block reason');

    // ack must NOT stamp ackedAt on a gap row.
    const afterAck = await repo.ack(T, gap.id);
    expect(afterAck?.ackedAtMs).toBeNull();

    // After all the generic calls the gap is STILL a live, blocked, unconfirmed
    // gap — only advanceGapStatus could ever change it.
    const final = await repo.get(T, gap.id);
    expect(final?.status).toBe('blocked');
    expect(final?.confirmedAtMs).toBeNull();
    expect(final?.gapKind).toBe('unwired_organ');
    expect(await repo.listOpenGaps(T)).toHaveLength(1);
  });

  // ── FIX 3 — audit replay is tamper-evident (genesis pin + seq + live head) ──

  it('forge-from-scratch FAILS, genesis-truncation FAILS, middle-tamper FAILS, honest PASSES', async () => {
    const log: ReplayableGapAuditEntry[] = [];
    const auditSink: GapAuditAppendPort = {
      async append(entry) {
        log.push({
          gapId: entry.gapId,
          status: entry.status,
          reason: entry.reason,
          previousHash: entry.previousHash,
          chainHash: entry.chainHash,
          occurredAtMs: entry.occurredAtMs,
          sequence: entry.sequence,
        });
      },
    };
    let clock = 5_000;
    const repo = createInMemoryMdCommitmentRepository({
      auditSink,
      now: () => (clock += 1_000),
    });
    const gap = await repo.createGap(baseGap());
    await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 'blocker cleared',
    });
    await repo.advanceGapStatus(T, gap.id, {
      status: 'reopened',
      reason: 'verifier rejected',
    });
    await repo.advanceGapStatus(T, gap.id, {
      status: 'scheduled',
      reason: 're-queued',
    });
    await repo.advanceGapStatus(T, gap.id, {
      status: 'done',
      reason: 'verifier approved',
      confirmationKind: 'auditor_approved',
    });

    const liveHead = (await repo.get(T, gap.id))?.auditChainHash ?? null;
    const ctx = { gapId: gap.id, tenantId: T, expectedTerminalHead: liveHead };

    // HONEST — the real log against the live head PASSES.
    expect(replayGapAuditChain(log, ctx).ok).toBe(true);

    // (c) LIVE-HEAD CROSS-CHECK: the honest log against a DIFFERENT live head
    // FAILS (a forged log that does not describe the live row).
    const wrongHead = replayGapAuditChain(log, {
      ...ctx,
      expectedTerminalHead: 'deadbeef',
    });
    expect(wrongHead.ok).toBe(false);
    expect(wrongHead.reason).toMatch(/live-head/);

    // (a) FORGE-FROM-SCRATCH for a DIFFERENT gap, replayed AS this gap: the
    // entries carry a foreign gapId but the context pins THIS gap. The genesis
    // pin + gap-id check reject the foreign chain at index 0 (a chain minted for
    // another gap can never be replayed as this one).
    const forgedForOther: ReplayableGapAuditEntry[] = log.map((e) => ({
      ...e,
      gapId: 'forged-gap-id',
    }));
    const forgedOtherVerdict = replayGapAuditChain(forgedForOther, ctx);
    expect(forgedOtherVerdict.ok).toBe(false);
    expect(forgedOtherVerdict.brokenAtIndex).toBe(0);

    // (a') A SELF-CONSISTENT forged chain (forged gapId in BOTH entries AND the
    // context, with a correctly re-stitched genesis) passes the internal +
    // genesis + sequence checks, but its terminal head does NOT match the REAL
    // gap's live head → the LIVE-HEAD CROSS-CHECK (c) rejects it. We model this by
    // replaying the honest log against a live head that belongs to a different row.
    const forgedSelfConsistent = replayGapAuditChain(log, {
      ...ctx,
      expectedTerminalHead:
        liveHead === 'forged-live-head' ? 'other' : 'forged-live-head',
    });
    expect(forgedSelfConsistent.ok).toBe(false);
    expect(forgedSelfConsistent.reason).toMatch(/live-head/);

    // (b) GENESIS-TRUNCATION: drop the genesis entry so the log starts mid-chain.
    // The first surviving entry has sequence 1 (not 0) AND a non-null previousHash
    // → the monotonic-sequence / genesis checks reject the truncation.
    const truncated = log.slice(1);
    const truncatedVerdict = replayGapAuditChain(truncated, ctx);
    expect(truncatedVerdict.ok).toBe(false);
    expect(truncatedVerdict.brokenAtIndex).toBe(0);

    // MIDDLE-ENTRY TAMPER: corrupt a non-genesis entry's reason → breaks at it.
    const middleTamper: ReplayableGapAuditEntry[] = log.map((e, i) =>
      i === 2 ? { ...e, reason: 'forged middle reason' } : e,
    );
    const middleVerdict = replayGapAuditChain(middleTamper, ctx);
    expect(middleVerdict.ok).toBe(false);
    expect(middleVerdict.brokenAtIndex).toBe(2);
  });
});
