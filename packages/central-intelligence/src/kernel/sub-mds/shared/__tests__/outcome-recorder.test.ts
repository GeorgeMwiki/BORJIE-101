/**
 * Regression test for HIGH-B — OutcomeRecorder must NOT silently
 * swallow SloEvent emission when the persistence sink throws (or vice
 * versa). The previous implementation awaited persistence first and
 * skipped the SloEvent emit on throw — so auto-rollback breaches went
 * undetected.
 */
import { describe, it, expect } from 'vitest';
import {
  createOutcomeRecorder,
  type OutcomeRecorderSink,
  type SloEventSink,
  type SubMdSloEvent,
} from '../outcome-recorder.js';
import type { ActualOutcome, PredictedOutcome } from '../sub-md-base.js';

function predicted(): PredictedOutcome {
  return {
    label: 'arrears.cleared',
    value: 100,
    unit: 'count',
    rationale: 'forecast based on prior month',
  };
}

function actual(value = 100): ActualOutcome {
  return {
    label: 'arrears.cleared',
    value,
    unit: 'count',
    recordedAtMs: 1_000_000,
  };
}

describe('OutcomeRecorder — HIGH-B partial-failure handling', () => {
  it('emits SloEvent even when persistence sink throws', async () => {
    const events: SubMdSloEvent[] = [];
    const sloSink: SloEventSink = {
      async emit(e) {
        events.push(e);
      },
    };
    const throwingSink: OutcomeRecorderSink = {
      async record() {
        throw new Error('audit-sink down');
      },
    };
    const errors: { msg: string; meta?: Record<string, unknown> }[] = [];
    const rec = createOutcomeRecorder(throwingSink, {
      tenantId: 't_1',
      sloEventSink: sloSink,
      logger: { error: (msg, meta) => errors.push({ msg, meta }) },
    });
    // Default (failFast=false): record returns successfully, persistence
    // failure is logged, SloEvent IS still emitted.
    const out = await rec.record({
      subMdName: 'arrears-chaser',
      predicted: predicted(),
      actual: actual(),
    });
    expect(out.verdict).toBe('on-target');
    expect(events).toHaveLength(1);
    expect(events[0]?.subMd).toBe('arrears-chaser');
    expect(errors.some((e) => e.msg.includes('persistence-sink'))).toBe(true);
  });

  it('logs and swallows SloEvent emit failure without throwing', async () => {
    const recorded: unknown[] = [];
    const persistSink: OutcomeRecorderSink = {
      async record(r) {
        recorded.push(r);
      },
    };
    const throwingSlo: SloEventSink = {
      async emit() {
        throw new Error('slo-stream down');
      },
    };
    const errors: { msg: string }[] = [];
    const rec = createOutcomeRecorder(persistSink, {
      tenantId: 't_1',
      sloEventSink: throwingSlo,
      logger: { error: (msg) => errors.push({ msg }) },
    });
    const out = await rec.record({
      subMdName: 'sm',
      predicted: predicted(),
      actual: actual(),
    });
    // Persistence still landed.
    expect(recorded).toHaveLength(1);
    // Outcome was returned despite the SLO emit failure.
    expect(out.verdict).toBe('on-target');
    expect(errors.some((e) => e.msg.includes('slo-event-sink'))).toBe(true);
  });

  it('failFast=true re-throws when a sink rejects', async () => {
    const sloSink: SloEventSink = {
      async emit() {
        throw new Error('slo-stream down');
      },
    };
    const rec = createOutcomeRecorder({
      tenantId: 't_1',
      sloEventSink: sloSink,
      failFast: true,
    });
    await expect(
      rec.record({
        subMdName: 'sm',
        predicted: predicted(),
        actual: actual(),
      }),
    ).rejects.toThrow(/slo-stream down/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// H5 regression — canonical single-options signature.
// ─────────────────────────────────────────────────────────────────────

describe('OutcomeRecorder — H5 single-options signature', () => {
  it('honours the canonical { sink, tenantId, sloEventSink } options shape', async () => {
    const persisted: Array<{ subMdName: string }> = [];
    const events: SubMdSloEvent[] = [];
    const sink: OutcomeRecorderSink = {
      async record(rec) {
        persisted.push({ subMdName: rec.subMdName });
      },
    };
    const sloSink: SloEventSink = {
      async emit(e) {
        events.push(e);
      },
    };
    const rec = createOutcomeRecorder({
      sink,
      sloEventSink: sloSink,
      tenantId: 't_1',
    });
    await rec.record({
      subMdName: 'sm',
      predicted: predicted(),
      actual: actual(),
    });
    expect(persisted.length).toBe(1);
    expect(events.length).toBe(1);
    expect(events[0]?.tenantId).toBe('t_1');
  });

  it('routes the canonical options shape without misclassifying as a sink (H5)', async () => {
    const persisted: Array<{ subMdName: string }> = [];
    const sink: OutcomeRecorderSink = {
      async record(rec) {
        persisted.push({ subMdName: rec.subMdName });
      },
    };
    const events: SubMdSloEvent[] = [];
    const sloSink: SloEventSink = {
      async emit(e) {
        events.push(e);
      },
    };
    // The presence of any options key (`sink`, `sloEventSink`, etc.)
    // signals the canonical path. Critically, the embedded sink must
    // NOT cause the OPTIONS object to be reclassified as a bare sink.
    const rec = createOutcomeRecorder({
      sink,
      sloEventSink: sloSink,
      tenantId: 't_2',
    });
    await rec.record({
      subMdName: 'sm',
      predicted: predicted(),
      actual: actual(),
    });
    // sloEventSink was NOT silently dropped (the latent H5 footgun).
    expect(events.length).toBe(1);
    expect(persisted.length).toBe(1);
  });
});
