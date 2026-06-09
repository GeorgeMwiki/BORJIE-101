/**
 * Capability Gap Register (Loop A, P0) — END-TO-END BEHAVIORAL SELF-TEST.
 *
 * `Docs/research/THE_METACOGNITIVE_SELF_MODEL.md` §7.1 / §7.4 / §7.5 / §7.6.
 *
 * This wires the REAL components together against a FRESH in-memory DB (the
 * in-memory `MdCommitmentRepository`):
 *   - the real `tool-dispatcher` DETECTION SEAM (a NOT_YET_WIRED organ →
 *     a typed `unwired_organ` gap row, while STILL failing the request);
 *   - the real `evaluateGapClears` watcher (re-probe the unblock trigger
 *     against the live capability snapshot);
 *   - the real `resolveDependents` DAG resolver (a single blocked_by edge);
 *   - the real verifier-gated `createGapAutoCompleter` (sovereign-parks,
 *     stale-resume-revalidates, no false-green) with an EXTERNAL fake Auditor.
 *
 * It proves the four required behaviors:
 *   1. inject a request needing a missing tool → a typed gap row is written
 *      (gapKind=unwired_organ, blockedBy/unblockTrigger set, status=blocked) and
 *      the request STILL fails (no faked success);
 *   2. register the tool + run the watcher tick → GapCleared fires, the
 *      EXTERNAL verifier passes, status→done with confirmedAt set + the audit
 *      hash chain advanced;
 *   3. a SOVEREIGN gap does NOT auto-actuate — it parks needs_approval;
 *   4. a failed-verification re-attempt leaves status != done (no false-green).
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryMdCommitmentRepository,
  type MdCommitmentRepository,
  type MdCommitment,
} from '@borjie/database';
import {
  orchestrator,
  evaluateGapClears,
  createGapAutoCompleter,
  type CapabilitySnapshot,
  type GapRow,
  type GapCleared,
  type ReattemptResult,
} from '@borjie/central-intelligence';
import { resolveDependents } from '@borjie/workflow-engine';

type GapDetectorPort = orchestrator.GapDetectorPort;
type HookContext = Parameters<
  GapDetectorPort['recordUnwiredOrganGap']
>[0]['ctx'];
type Decision = Parameters<
  ReturnType<typeof orchestrator.createToolDispatcher>['dispatch']
>[0];
const { createToolDispatcher } = orchestrator;

const TENANT = 'tenant-gap-test';
const MISSING_TOOL = 'platform.suspend_licence';

// ── Test doubles ───────────────────────────────────────────────────────────

/** A HookContext bound to the test tenant (the gap row's tenant comes from here). */
function ctxFor(tenantId: string): HookContext {
  return {
    threadId: 'thr-1',
    scope: { kind: 'tenant', tenantId } as HookContext['scope'],
    tier: 'tenant',
    userMessage: 'suspend the Geita licence',
    tickStartedAt: 0,
  };
}

/** A registry whose tool resolves to a NOT_YET_WIRED organ (executor-failed). */
function unwiredRegistry(): { runTool: () => Promise<unknown> } {
  return {
    async runTool() {
      return {
        kind: 'executor-failed' as const,
        message: `${MISSING_TOOL} adapter not yet wired in api-gateway`,
      };
    },
  };
}

/**
 * The composition-root adapter that wires the kernel detection seam onto the
 * durable repo: a NOT_YET_WIRED organ hit writes an `unwired_organ` gap keyed
 * on the missing tool, with unblock_trigger { tool_registered, <toolName> }.
 */
function gapDetectorOver(
  repo: MdCommitmentRepository,
  opts?: { readonly sovereign?: boolean },
): GapDetectorPort {
  return {
    async recordUnwiredOrganGap({ toolName, gapKind, intent, ctx }) {
      const tenantId =
        ctx.scope.kind === 'tenant' ? ctx.scope.tenantId : 'platform';
      await repo.createGap({
        tenantId,
        threadId: ctx.threadId,
        gapKind,
        kind: `dispatch.${toolName}`,
        title: `Blocked: ${toolName} is not yet available`,
        titleSw: `Imezuiwa: ${toolName} bado haipatikani`,
        rationale: intent,
        evidenceIds: [`gap:${toolName}`],
        unblockTrigger: { kind: 'tool_registered', target: toolName },
        competenceDomain: 'licences',
        sovereign: opts?.sovereign ?? false,
        idempotencyKey: `gap:${gapKind}:${toolName}`,
      });
    },
  };
}

/** Project a durable gap row onto the pure watcher's GapRow shape. */
function toWatchRow(c: MdCommitment): GapRow {
  return {
    id: c.id,
    gapKind: c.gapKind as GapRow['gapKind'],
    status: c.status as GapRow['status'],
    unblockTrigger: c.unblockTrigger,
    sovereign: c.sovereign,
  };
}

/** A capability snapshot in which `tools` are registered. */
function snapshotWith(tools: ReadonlyArray<string>): CapabilitySnapshot {
  return {
    registeredTools: new Set(tools),
    wiredOrgans: new Set(),
    enabledFlags: new Set(),
    grantedApprovals: new Set(),
    resolvableEvidence: new Set(),
    shippedFeatures: new Set(),
  };
}

/**
 * The composition-root status sink over the repo (the audit-chain advance).
 * Mirrors the production wiring of `advanceGapStatus`.
 */
function statusSinkOver(repo: MdCommitmentRepository, tenantId: string) {
  return {
    async schedule(gapId: string, reason: string) {
      await repo.advanceGapStatus(tenantId, gapId, {
        status: 'scheduled',
        reason,
      });
    },
    async complete(gapId: string, confirmationKind: string, reason: string) {
      await repo.advanceGapStatus(tenantId, gapId, {
        status: 'done',
        reason,
        confirmationKind,
      });
    },
    async reopen(gapId: string, reason: string) {
      await repo.advanceGapStatus(tenantId, gapId, {
        status: 'reopened',
        reason,
      });
    },
    async parkForApproval(gapId: string, reason: string) {
      await repo.advanceGapStatus(tenantId, gapId, {
        status: 'blocked',
        reason,
        blockedReason: `needs_approval: ${reason}`,
      });
    },
  };
}

// ── Test 1 + 2: detect → register → watcher → verifier → done ────────────────

describe('Capability Gap Register — Loop A P0 end-to-end', () => {
  it('detects an unwired organ as a typed gap (request STILL fails)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const dispatcher = createToolDispatcher({
      registry: unwiredRegistry() as never,
      gapDetector: gapDetectorOver(repo),
    });

    const decision: Decision = {
      kind: 'tool_call',
      call: { toolName: MISSING_TOOL, input: {}, callId: 'c1' },
    } as Decision;

    const result = await dispatcher.dispatch(decision, ctxFor(TENANT));

    // The request STILL fails honestly — no faked success.
    expect(result.kind).toBe('tool_error');

    // A typed gap row was durably written.
    const gaps = await repo.listOpenGaps(TENANT);
    expect(gaps).toHaveLength(1);
    const gap = gaps[0];
    expect(gap.gapKind).toBe('unwired_organ');
    expect(gap.status).toBe('blocked');
    expect(gap.unblockTrigger).toEqual({
      kind: 'tool_registered',
      target: MISSING_TOOL,
    });
    expect(gap.blockedBy).toEqual([]);
    expect(gap.evidenceIds.length).toBeGreaterThanOrEqual(1);
    expect(gap.confirmedAtMs).toBeNull();
  });

  it('auto-completes when the tool registers — verifier-gated, audit chain advances', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const dispatcher = createToolDispatcher({
      registry: unwiredRegistry() as never,
      gapDetector: gapDetectorOver(repo),
    });

    // (1) detect.
    await dispatcher.dispatch(
      {
        kind: 'tool_call',
        call: { toolName: MISSING_TOOL, input: {}, callId: 'c1' },
      } as Decision,
      ctxFor(TENANT),
    );
    const before = (await repo.listOpenGaps(TENANT))[0];
    expect(before.status).toBe('blocked');
    expect(before.auditChainHash).toBeNull();

    // (2) the tool is now REGISTERED — the watcher re-probes the live snapshot.
    const openGaps = await repo.listOpenGaps(TENANT);
    const watch = evaluateGapClears(
      openGaps.map(toWatchRow),
      snapshotWith([MISSING_TOOL]),
    );
    expect(watch.cleared).toHaveLength(1);
    const cleared: GapCleared = watch.cleared[0];
    expect(cleared.gapId).toBe(before.id);

    // (3) the verifier-gated auto-completer drives the GapCleared to done. The
    // EXTERNAL verifier (fake Auditor) approves a non-empty evidence chain.
    const completer = createGapAutoCompleter({
      statusSink: statusSinkOver(repo, TENANT),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          // Re-validate preconditions + re-attempt → produce a real evidence id.
          return { ok: true, evidenceIds: ['reattempt-evidence-1'] };
        },
      },
      verifier: {
        async verify({ evidenceIds }) {
          // EXTERNAL Auditor gate: >=1 evidence id AND no contradiction.
          return {
            approved: evidenceIds.length >= 1,
            confirmationKind: 'auditor_approved',
            reason: 'evidence chain resolves',
          };
        },
      },
    });

    const outcome = await completer.complete(cleared);
    expect(outcome.outcome).toBe('completed');

    // status → done, confirmedAt stamped, audit chain advanced (append-only).
    const done = await repo.get(TENANT, before.id);
    expect(done?.status).toBe('done');
    expect(done?.confirmedAtMs).not.toBeNull();
    expect(done?.confirmationKind).toBe('auditor_approved');
    expect(done?.auditChainHash).toBeTruthy();
    // The gap is no longer open.
    expect(await repo.listOpenGaps(TENANT)).toHaveLength(0);
  });

  // ── Test 3: SOVEREIGN gap never auto-actuates ──────────────────────────────

  it('a sovereign gap parks needs_approval — never auto-actuates', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const dispatcher = createToolDispatcher({
      registry: unwiredRegistry() as never,
      gapDetector: gapDetectorOver(repo, { sovereign: true }),
    });

    await dispatcher.dispatch(
      {
        kind: 'tool_call',
        call: { toolName: MISSING_TOOL, input: {}, callId: 'c1' },
      } as Decision,
      ctxFor(TENANT),
    );
    const gap = (await repo.listOpenGaps(TENANT))[0];
    expect(gap.sovereign).toBe(true);

    // The blocker clears (tool registered), but the completer MUST NOT complete.
    const watch = evaluateGapClears(
      [toWatchRow(gap)],
      snapshotWith([MISSING_TOOL]),
    );
    const cleared = watch.cleared[0];

    let reattempted = false;
    const completer = createGapAutoCompleter({
      statusSink: statusSinkOver(repo, TENANT),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          reattempted = true; // must NEVER run for a sovereign gap.
          return { ok: true, evidenceIds: ['x'] };
        },
      },
      verifier: {
        async verify() {
          return {
            approved: true,
            confirmationKind: 'auditor_approved',
            reason: 'ok',
          };
        },
      },
    });

    const outcome = await completer.complete(cleared);
    expect(outcome.outcome).toBe('parked_sovereign');
    expect(reattempted).toBe(false);

    const after = await repo.get(TENANT, gap.id);
    expect(after?.status).not.toBe('done');
    expect(after?.confirmedAtMs).toBeNull();
    expect(after?.blockedReason).toContain('needs_approval');
  });

  // ── Test 4: failed verification leaves status != done (no false-green) ─────

  it('a failed-verification re-attempt leaves status != done', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const dispatcher = createToolDispatcher({
      registry: unwiredRegistry() as never,
      gapDetector: gapDetectorOver(repo),
    });

    await dispatcher.dispatch(
      {
        kind: 'tool_call',
        call: { toolName: MISSING_TOOL, input: {}, callId: 'c1' },
      } as Decision,
      ctxFor(TENANT),
    );
    const gap = (await repo.listOpenGaps(TENANT))[0];

    const watch = evaluateGapClears(
      [toWatchRow(gap)],
      snapshotWith([MISSING_TOOL]),
    );
    const cleared = watch.cleared[0];

    const completer = createGapAutoCompleter({
      statusSink: statusSinkOver(repo, TENANT),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          // A plausible-but-wrong remediation: produces evidence the Auditor
          // will REJECT (the false-green trap).
          return { ok: true, evidenceIds: ['plausible-but-wrong'] };
        },
      },
      verifier: {
        async verify() {
          // EXTERNAL verifier REJECTS — this is the only authority on `done`.
          return {
            approved: false,
            confirmationKind: 'auditor_approved',
            reason: 'evidence contradicts the licence register',
          };
        },
      },
    });

    const outcome = await completer.complete(cleared);
    expect(outcome.outcome).toBe('reopened');

    const after = await repo.get(TENANT, gap.id);
    expect(after?.status).not.toBe('done'); // NO false-green.
    expect(after?.confirmedAtMs).toBeNull();
    expect(after?.status).toBe('reopened');
  });

  // ── DAG resolver: a single blocked_by edge becomes READY on clear ─────────

  it('resolveDependents marks a single-edge dependent READY on clear', () => {
    const resolution = resolveDependents('gap-A', [
      { id: 'gap-B', blockedBy: ['gap-A'] },
      { id: 'gap-C', blockedBy: ['gap-A', 'gap-Z'] }, // still blocked on gap-Z.
    ]);
    expect(resolution.ready.map((r) => r.gapId)).toEqual(['gap-B']);
    expect(resolution.stillBlocked).toEqual(['gap-C']);
  });
});
