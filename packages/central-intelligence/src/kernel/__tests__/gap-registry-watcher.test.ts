/**
 * GapRegistryWatcher + GapAutoCompleter unit tests (pure core, Loop A P0).
 *
 * Asserts the pure blocker-clear probe + the verifier-gated completion
 * invariants in isolation (no DB, no IO):
 *   - a trigger clears ONLY when the live snapshot satisfies it;
 *   - a gap with no trigger never clears;
 *   - a sovereign GapCleared PARKS (never auto-actuates);
 *   - a failed verifier REOPENS (no false-green);
 *   - a stale-resume failure REOPENS (re-validation gate).
 */

import { describe, it, expect } from 'vitest';

import {
  evaluateGapClears,
  isTriggerSatisfied,
  type CapabilitySnapshot,
  type GapRow,
} from '../gap-registry-watcher.js';
import {
  createGapAutoCompleter,
  type GapCleared,
  type ReattemptResult,
} from '../gap-auto-completer.js';

function emptySnapshot(): CapabilitySnapshot {
  return {
    registeredTools: new Set(),
    wiredOrgans: new Set(),
    enabledFlags: new Set(),
    grantedApprovals: new Set(),
    resolvableEvidence: new Set(),
    shippedFeatures: new Set(),
  };
}

function gap(partial: Partial<GapRow>): GapRow {
  return {
    id: 'g1',
    gapKind: 'unwired_organ',
    status: 'blocked',
    unblockTrigger: { kind: 'tool_registered', target: 'platform.x' },
    sovereign: false,
    ...partial,
  };
}

describe('GapRegistryWatcher (pure)', () => {
  it('clears a tool_registered trigger only when the tool is registered', () => {
    const snap = { ...emptySnapshot(), registeredTools: new Set(['platform.x']) };
    expect(
      isTriggerSatisfied({ kind: 'tool_registered', target: 'platform.x' }, snap),
    ).toBe(true);
    expect(
      isTriggerSatisfied({ kind: 'tool_registered', target: 'platform.y' }, snap),
    ).toBe(false);
  });

  it('treats a WIRED organ as clearing a tool_registered trigger', () => {
    const snap = { ...emptySnapshot(), wiredOrgans: new Set(['organ.z']) };
    expect(
      isTriggerSatisfied({ kind: 'tool_registered', target: 'organ.z' }, snap),
    ).toBe(true);
  });

  it('never clears a gap with no trigger', () => {
    const result = evaluateGapClears(
      [gap({ unblockTrigger: null })],
      emptySnapshot(),
    );
    expect(result.cleared).toHaveLength(0);
    expect(result.probed).toBe(1);
  });

  it('collects exactly the gaps whose triggers are satisfied', () => {
    const snap = { ...emptySnapshot(), registeredTools: new Set(['platform.x']) };
    const result = evaluateGapClears(
      [
        gap({ id: 'a', unblockTrigger: { kind: 'tool_registered', target: 'platform.x' } }),
        gap({ id: 'b', unblockTrigger: { kind: 'tool_registered', target: 'platform.other' } }),
      ],
      snap,
    );
    expect(result.cleared.map((c) => c.gapId)).toEqual(['a']);
  });

  it('is idempotent — re-running with the same inputs yields the same set', () => {
    const snap = { ...emptySnapshot(), enabledFlags: new Set(['flag.q']) };
    const rows = [
      gap({ id: 'f', gapKind: 'structural', unblockTrigger: { kind: 'flag_enabled', target: 'flag.q' } }),
    ];
    const first = evaluateGapClears(rows, snap);
    const second = evaluateGapClears(rows, snap);
    expect(first.cleared.map((c) => c.gapId)).toEqual(second.cleared.map((c) => c.gapId));
  });
});

function clearedFor(partial: Partial<GapCleared>): GapCleared {
  return {
    gapId: 'g1',
    gapKind: 'unwired_organ',
    trigger: { kind: 'tool_registered', target: 'platform.x' },
    sovereign: false,
    ...partial,
  };
}

interface SinkLog {
  readonly calls: Array<{ readonly op: string; readonly gapId: string }>;
}

function fakeSink(log: SinkLog) {
  return {
    async schedule(gapId: string) {
      log.calls.push({ op: 'schedule', gapId });
    },
    async complete(gapId: string) {
      log.calls.push({ op: 'complete', gapId });
    },
    async reopen(gapId: string) {
      log.calls.push({ op: 'reopen', gapId });
    },
    async parkForApproval(gapId: string) {
      log.calls.push({ op: 'parkForApproval', gapId });
    },
  };
}

describe('GapAutoCompleter (verifier-gated)', () => {
  it('completes on a passing external verifier', async () => {
    const log: SinkLog = { calls: [] };
    const completer = createGapAutoCompleter({
      statusSink: fakeSink(log),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          return { ok: true, evidenceIds: ['e1'] };
        },
      },
      verifier: {
        async verify() {
          return { approved: true, confirmationKind: 'auditor_approved', reason: 'ok' };
        },
      },
    });
    const out = await completer.complete(clearedFor({}));
    expect(out.outcome).toBe('completed');
    expect(log.calls.map((c) => c.op)).toEqual(['schedule', 'complete']);
  });

  it('parks a sovereign gap and NEVER re-attempts', async () => {
    const log: SinkLog = { calls: [] };
    let reattempted = false;
    const completer = createGapAutoCompleter({
      statusSink: fakeSink(log),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          reattempted = true;
          return { ok: true, evidenceIds: ['e1'] };
        },
      },
      verifier: {
        async verify() {
          return { approved: true, confirmationKind: 'auditor_approved', reason: 'ok' };
        },
      },
    });
    const out = await completer.complete(clearedFor({ sovereign: true }));
    expect(out.outcome).toBe('parked_sovereign');
    expect(reattempted).toBe(false);
    expect(log.calls.map((c) => c.op)).toEqual(['parkForApproval']);
  });

  it('reopens (no false-green) when the external verifier rejects', async () => {
    const log: SinkLog = { calls: [] };
    const completer = createGapAutoCompleter({
      statusSink: fakeSink(log),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          return { ok: true, evidenceIds: ['plausible-but-wrong'] };
        },
      },
      verifier: {
        async verify() {
          return { approved: false, confirmationKind: 'auditor_approved', reason: 'contradiction' };
        },
      },
    });
    const out = await completer.complete(clearedFor({}));
    expect(out.outcome).toBe('reopened');
    expect(log.calls.map((c) => c.op)).toEqual(['schedule', 'reopen']);
  });

  it('reopens when stale-resume re-validation fails (never ships stale work)', async () => {
    const log: SinkLog = { calls: [] };
    const completer = createGapAutoCompleter({
      statusSink: fakeSink(log),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          return { ok: false, reason: 'precondition changed: licence already suspended' };
        },
      },
      verifier: {
        async verify() {
          // Must never be reached — a stale-resume short-circuits before verify.
          throw new Error('verify should not run on a stale-resume failure');
        },
      },
    });
    const out = await completer.complete(clearedFor({}));
    expect(out.outcome).toBe('reopened');
    expect(log.calls.map((c) => c.op)).toEqual(['schedule', 'reopen']);
  });
});

// ── FIX 2/3 — a sovereign GapCleared parks terminal (not done, not live) ──────

describe('GapAutoCompleter — sovereign park is the only path for a sovereign gap', () => {
  it('parks (parkForApproval ONLY) for a sovereign gap — never schedules / completes', async () => {
    const log: SinkLog = { calls: [] };
    let reattempted = false;
    const completer = createGapAutoCompleter({
      statusSink: fakeSink(log),
      continuation: {
        async reattempt(): Promise<ReattemptResult> {
          reattempted = true;
          return { ok: true, evidenceIds: ['e1'] };
        },
      },
      verifier: {
        async verify() {
          return { approved: true, confirmationKind: 'auditor_approved', reason: 'ok' };
        },
      },
    });
    const out = await completer.complete(clearedFor({ sovereign: true }));
    expect(out.outcome).toBe('parked_sovereign');
    // The ONLY sink call is the terminal park — no schedule, no complete.
    expect(log.calls.map((c) => c.op)).toEqual(['parkForApproval']);
    expect(reattempted).toBe(false);
  });

  it('the watcher only re-probes live gaps — a terminal-parked gap is not in the set', () => {
    // The composition root reads listOpenGaps (LIVE only). A needs_approval /
    // dead_letter gap is excluded by the repo, so the watcher never sees it and
    // cannot re-clear + re-park it (the storm guard at the boundary). We model
    // that here: only a `blocked` gap is fed to the watcher.
    const snap = { ...emptySnapshot(), registeredTools: new Set(['platform.x']) };
    const liveOnly = [gap({ id: 'live', status: 'blocked' })];
    const result = evaluateGapClears(liveOnly, snap);
    expect(result.cleared.map((c) => c.gapId)).toEqual(['live']);
    expect(result.probed).toBe(1);
  });
});
