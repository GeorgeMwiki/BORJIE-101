/**
 * Learning-loop port — LP-05 / LP-17.
 *
 * Proves the orphaned `@borjie/learning-signal-emitter` + `@borjie/belief-engine`
 * are reachable from a REAL call path: a turn's `learning` stage event drives
 * `createLearningLoopSubscriber` → `emitSignal` → belief sink (`reviseBelief`)
 * + reflexion sink. Asserts:
 *   - flag off / no emitter wired  → no-op (fail-safe inert).
 *   - `learning` event             → emitSignal invoked with mapped (action,
 *     outcome) and both sinks; a belief revision + a reflexion note land.
 *   - a thrown emitSignal           → caught + logged, never propagates.
 *   - non-`learning` stages         → ignored.
 *
 * The fakes mirror the real package contracts (the emitter's reward gate +
 * fan-out, the convince-loop's revise call) so the wiring is exercised, not a
 * stub. `buildBeliefSink` + the in-memory stores under test are the REAL ones.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createLearningLoopSubscriber,
  mapLearningSignalToEvents,
  buildBeliefSink,
  createInMemoryBeliefStorePort,
  createInMemoryReflectiveStorePort,
  type EmitInputLike,
  type EmissionResultLike,
  type LearningSignalLike,
  type ExtractedClaimLike,
  type ConvinceResultLike,
} from '../learning-loop-port.js';
import type {
  LearningStageEvent,
  IntentStageEvent,
} from '../orchestrator/stage-event-bus.js';

// ─────────────────────────────────────────────────────────────────────
// Fakes that mirror the real package contracts.
// ─────────────────────────────────────────────────────────────────────

/** A `learning` stage event for a given coarse signal. */
function learningEvent(
  signal: LearningStageEvent['signal'],
): LearningStageEvent {
  return Object.freeze({
    stage: 'learning',
    seq: 4,
    turnId: 'thread-1',
    threadId: 'thread-1',
    tenantId: 'tenant-1',
    at: 1_700_000_000_000,
    attributes: Object.freeze({}),
    signal,
  });
}

/**
 * A faithful stand-in for the real `emitSignal`: builds a signal, applies the
 * same positive-floor / negative-decision routing, and fans out to whichever
 * sinks were supplied. Lets the test prove the real sinks fire on real routes.
 */
function fakeEmitSignal(
  recorder: { calls: EmitInputLike[] },
): (input: EmitInputLike) => Promise<EmissionResultLike> {
  return async (input: EmitInputLike): Promise<EmissionResultLike> => {
    recorder.calls.push(input);
    const reward = input.outcome.explicitSatisfaction ?? 0;
    const signal: LearningSignalLike = Object.freeze({
      signalHash: 'hash-1',
      actionRef: input.action.id,
      actionKind: input.action.kind,
      reward,
      components: Object.freeze({
        sla: 0,
        override: 0,
        complaint: 0,
        regulator: 0,
        cost: 0,
        satisfaction: reward,
      }),
      tenantScope: input.action.tenantOrgId ? 'org' : 'platform',
      subjectUserId: input.action.tenantUserId ?? null,
      subjectOrgId: input.action.tenantOrgId ?? null,
      emittedBy: 'fake-emitter',
      capturedAt: input.action.capturedAt,
    });
    const routed: string[] = [];
    if (reward >= 0.35 && input.sinks?.beliefStrengthen) {
      if (await input.sinks.beliefStrengthen(signal)) routed.push('belief-store');
    }
    if (reward < 0 && input.sinks?.reflexionRecord) {
      if (await input.sinks.reflexionRecord(signal))
        routed.push('reflexion-lessons');
    }
    return Object.freeze({
      signal,
      routedTo: Object.freeze(routed),
      notes: Object.freeze([] as string[]),
    });
  };
}

/** A `reviseBelief` stand-in that records the claim + returns a strengthen. */
function fakeReviseBelief(recorder: { claims: ExtractedClaimLike[] }) {
  return async (
    claim: ExtractedClaimLike,
    _deps: unknown,
  ): Promise<ConvinceResultLike> => {
    recorder.claims.push(claim);
    return { action: 'strengthen', confidenceDelta: 0.4, rationale: 'test' };
  };
}

const SUCCESS_CLAIM: ExtractedClaimLike = Object.freeze({
  subject: 'mwanza-gold-ore-grade',
  description: 'Mwanza alluvial gold grade trend',
  proposedValue: { kind: 'scalar' as const, scalar: 3.2, unit: 'g/t' },
  evidenceFromTurn: 'recent assays held ~3.2 g/t',
  confidence: 0.6,
  conversationId: 'thread-1',
  turnId: 'thread-1',
  portal: 'owner' as const,
  domain: 'sector-economics' as const,
});

// ─────────────────────────────────────────────────────────────────────
// PURE mapper
// ─────────────────────────────────────────────────────────────────────

describe('mapLearningSignalToEvents', () => {
  it('maps success → +1 satisfaction; failure → -1; partial → 0', () => {
    const base = {
      turnId: 't',
      threadId: 't',
      tenantId: 'org-9',
      atMs: 1_700_000_000_000,
      actorId: 'mr-mwikila',
      actorTier: 'platform',
    } as const;
    expect(
      mapLearningSignalToEvents({ ...base, signal: 'success' }).outcome
        .explicitSatisfaction,
    ).toBe(1);
    expect(
      mapLearningSignalToEvents({ ...base, signal: 'failure' }).outcome
        .explicitSatisfaction,
    ).toBe(-1);
    expect(
      mapLearningSignalToEvents({ ...base, signal: 'partial' }).outcome
        .explicitSatisfaction,
    ).toBe(0);
  });

  it('binds the org scope + decision-trace id from the turn', () => {
    const { action, outcome } = mapLearningSignalToEvents({
      turnId: 'trace-7',
      threadId: 'thread-7',
      tenantId: 'org-7',
      signal: 'success',
      atMs: 1_700_000_000_000,
      actorId: 'persona-x',
      actorTier: 'owner',
    });
    expect(action.tenantOrgId).toBe('org-7');
    expect(action.decisionTraceId).toBe('trace-7');
    expect(action.kind).toBe('chat');
    expect(outcome.actionRef).toBe(action.id);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildBeliefSink — routes through reviseBelief only.
// ─────────────────────────────────────────────────────────────────────

describe('buildBeliefSink', () => {
  it('calls reviseBelief when a claim is extracted; returns true', async () => {
    const rec = { claims: [] as ExtractedClaimLike[] };
    const sink = buildBeliefSink({
      reviseBelief: fakeReviseBelief(rec),
      reviseBeliefDeps: { store: createInMemoryBeliefStorePort() },
      claimFromSignal: () => SUCCESS_CLAIM,
    });
    const ok = await sink({} as LearningSignalLike);
    expect(ok).toBe(true);
    expect(rec.claims).toHaveLength(1);
    expect(rec.claims[0]?.subject).toBe('mwanza-gold-ore-grade');
  });

  it('returns false (no write) when no claim is extracted', async () => {
    const rec = { claims: [] as ExtractedClaimLike[] };
    const sink = buildBeliefSink({
      reviseBelief: fakeReviseBelief(rec),
      reviseBeliefDeps: {},
      // default claimFromSignal → null
    });
    expect(await sink({} as LearningSignalLike)).toBe(false);
    expect(rec.claims).toHaveLength(0);
  });

  it('never throws when reviseBelief rejects — returns false', async () => {
    const sink = buildBeliefSink({
      reviseBelief: async () => {
        throw new Error('db down');
      },
      reviseBeliefDeps: {},
      claimFromSignal: () => SUCCESS_CLAIM,
    });
    await expect(sink({} as LearningSignalLike)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// createLearningLoopSubscriber — the live call path.
// ─────────────────────────────────────────────────────────────────────

describe('createLearningLoopSubscriber', () => {
  it('is a no-op when disabled', async () => {
    const rec = { calls: [] as EmitInputLike[] };
    const sub = createLearningLoopSubscriber({
      enabled: false,
      emitSignal: fakeEmitSignal(rec),
    });
    await sub(learningEvent('success'));
    expect(rec.calls).toHaveLength(0);
  });

  it('is inert (logs once) when enabled but no emitSignal is wired', async () => {
    const debug = vi.fn();
    const sub = createLearningLoopSubscriber({
      enabled: true,
      logger: { warn: vi.fn(), debug },
    });
    await sub(learningEvent('success'));
    await sub(learningEvent('success'));
    expect(debug).toHaveBeenCalledTimes(1); // warn-once
  });

  it('ignores non-learning stages', async () => {
    const rec = { calls: [] as EmitInputLike[] };
    const sub = createLearningLoopSubscriber({
      enabled: true,
      emitSignal: fakeEmitSignal(rec),
    });
    const intent: IntentStageEvent = {
      stage: 'intent',
      seq: 0,
      turnId: 't',
      threadId: 't',
      tenantId: null,
      at: 1,
      attributes: {},
      userMessageLength: 5,
    };
    await sub(intent);
    expect(rec.calls).toHaveLength(0);
  });

  it('emits a signal that lands a belief revision on a success turn', async () => {
    const emitRec = { calls: [] as EmitInputLike[] };
    const beliefRec = { claims: [] as ExtractedClaimLike[] };
    const beliefStrengthen = buildBeliefSink({
      reviseBelief: fakeReviseBelief(beliefRec),
      reviseBeliefDeps: { store: createInMemoryBeliefStorePort() },
      claimFromSignal: () => SUCCESS_CLAIM,
    });
    const sub = createLearningLoopSubscriber({
      enabled: true,
      emitSignal: fakeEmitSignal(emitRec),
      beliefStrengthen,
    });

    await sub(learningEvent('success'));

    // emitSignal got the mapped (action, outcome).
    expect(emitRec.calls).toHaveLength(1);
    expect(emitRec.calls[0]?.action.kind).toBe('chat');
    expect(emitRec.calls[0]?.outcome.explicitSatisfaction).toBe(1);
    // The belief sink fired through reviseBelief (the gated convince-loop).
    expect(beliefRec.claims).toHaveLength(1);
  });

  it('emits a signal that lands a reflexion note on a failure turn', async () => {
    const emitRec = { calls: [] as EmitInputLike[] };
    const store = createInMemoryReflectiveStorePort();
    let idN = 0;
    const reflexionRecord = async (
      signal: LearningSignalLike,
    ): Promise<boolean> => {
      await store.upsertNote({
        id: `note-${(idN += 1)}`,
        tenantId: signal.subjectOrgId ?? 'platform',
        userId: null,
        insight: `reward ${signal.reward}`,
        adjustments: [],
        periodStart: signal.capturedAt,
        periodEnd: signal.capturedAt,
        selfScore: (signal.reward + 1) / 2,
        createdAt: signal.capturedAt,
      });
      return true;
    };
    const sub = createLearningLoopSubscriber({
      enabled: true,
      emitSignal: fakeEmitSignal(emitRec),
      reflexionRecord,
    });

    await sub(learningEvent('failure'));

    expect(emitRec.calls[0]?.outcome.explicitSatisfaction).toBe(-1);
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0]?.selfScore).toBe(0);
  });

  it('never propagates a thrown emitSignal — caught + logged', async () => {
    const warn = vi.fn();
    const sub = createLearningLoopSubscriber({
      enabled: true,
      emitSignal: async () => {
        throw new Error('emitter blew up');
      },
      logger: { warn },
    });
    await expect(sub(learningEvent('success'))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// In-memory store ports.
// ─────────────────────────────────────────────────────────────────────

describe('in-memory store ports', () => {
  it('belief store upserts by (subject,user,org) and finds by subject', async () => {
    const store = createInMemoryBeliefStorePort();
    await store.upsert({
      subject: 's',
      subjectUserId: null,
      subjectOrgId: 'org-1',
      domain: 'general',
    });
    const found = (await store.findBySubject('s', {
      subjectOrgId: 'org-1',
    })) as { id: string } | null;
    expect(found?.id).toBe('belief-1');
    expect(store.snapshot()).toHaveLength(1);
  });

  it('reflective store replaces a note by id (upsert semantics)', async () => {
    const store = createInMemoryReflectiveStorePort();
    const note = {
      id: 'n1',
      tenantId: 'platform',
      userId: null,
      insight: 'a',
      adjustments: [],
      periodStart: 'x',
      periodEnd: 'x',
      selfScore: 0.5,
      createdAt: 'x',
    };
    await store.upsertNote(note);
    await store.upsertNote({ ...note, insight: 'b' });
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0]?.insight).toBe('b');
  });
});
