/**
 * builtin-loops — the proof-of-concept LoopSpec round-trips the shipped
 * forecast-surprise drive, ADDITIVELY (the drive itself is untouched).
 */

import { describe, it, expect } from 'vitest';
import {
  createForecastSurpriseLoop,
  FORECAST_SURPRISE_LOOP_ID,
  FORECAST_SURPRISE_ACT_PORT,
  SITUATIONAL_SNAPSHOT_PORT,
} from '../builtin-loops.js';
import { scheduleLoops } from '../loop-scheduler.js';
import { createLoopRegistry } from '../loop-registry.js';
import { FORECAST_SURPRISE_DRIVE } from '../../motivation/default-drives.js';
import type {
  ActivatedEntity,
  SituationalSnapshot,
} from '../../situational-model/types.js';

function entity(
  entityId: string,
  attributes: Record<string, unknown>,
): ActivatedEntity {
  return {
    entity: {
      tenantId: 't1',
      entityId,
      kind: 'cash',
      label: entityId,
      attributes,
      referenceCount: 1,
      firstReferencedAtMs: 0,
      lastReferencedAtMs: 0,
      associations: {},
      updatedAtMs: 0,
    },
    activation: 1,
    baseLevel: 1,
    spreading: 0,
  };
}

function snapshot(entities: ActivatedEntity[]): SituationalSnapshot {
  return {
    tenantId: 't1',
    entities,
    broadcast: entities[0] ?? null,
    computedAtMs: 0,
  };
}

// A snapshot WITH a sharply-divergent surpriseDrift (> 0.4 band) → drive unsatisfied.
const SURPRISING = snapshot([entity('cash-1', { surpriseDrift: 0.8 })]);
// A snapshot with low drift → drive satisfied.
const CALM = snapshot([entity('cash-1', { surpriseDrift: 0.1 })]);

describe('createForecastSurpriseLoop — round-trips the shipped drive', () => {
  it('builds a builtin tick LoopSpec bound to the snapshot port', () => {
    const spec = createForecastSurpriseLoop({ createdAtMs: 0 });
    expect(spec.id).toBe(FORECAST_SURPRISE_LOOP_ID);
    expect(spec.origin).toBe('builtin');
    expect(spec.trigger.kind).toBe('tick');
    expect(spec.organBindings).toContain(SITUATIONAL_SNAPSHOT_PORT);
    expect(spec.actPort).toBe(FORECAST_SURPRISE_ACT_PORT);
    // A surprise concern is a NUDGE — never an autonomous act.
    expect(spec.autonomyTier).toBe('T1');
  });

  it('evaluate fires iff the underlying drive is UNSATISFIED', () => {
    const spec = createForecastSurpriseLoop({ createdAtMs: 0 });
    const ctxFor = (snap: SituationalSnapshot) =>
      ({ nowMs: 0, ports: { [SITUATIONAL_SNAPSHOT_PORT]: snap } });
    expect(spec.evaluate(ctxFor(SURPRISING))).toBe(true);
    expect(spec.evaluate(ctxFor(CALM))).toBe(false);
  });

  it('declines to fire when the snapshot port is absent or malformed', () => {
    const spec = createForecastSurpriseLoop({ createdAtMs: 0 });
    expect(spec.evaluate({ nowMs: 0, ports: {} })).toBe(false);
    expect(spec.evaluate({ nowMs: 0, ports: { [SITUATIONAL_SNAPSHOT_PORT]: 42 } })).toBe(false);
  });

  it('decide returns a membrane-bound action descriptor mirroring the drive assessment', () => {
    const spec = createForecastSurpriseLoop({ createdAtMs: 0 });
    const action = spec.decide({
      nowMs: 0,
      ports: { [SITUATIONAL_SNAPSHOT_PORT]: SURPRISING },
    });
    const assessment = FORECAST_SURPRISE_DRIVE.evaluate(SURPRISING, {});
    expect(action).not.toBeNull();
    expect(action?.actPort).toBe(FORECAST_SURPRISE_ACT_PORT);
    expect(action?.summary).toBe(assessment.summary);
    expect(action?.args).toMatchObject({
      driveId: 'forecast-surprise',
      tenantId: 't1',
      breachSeverity: assessment.breachSeverity,
    });
  });

  it('decide is observe-only (null) when the drive is satisfied', () => {
    const spec = createForecastSurpriseLoop({ createdAtMs: 0 });
    const action = spec.decide({
      nowMs: 0,
      ports: { [SITUATIONAL_SNAPSHOT_PORT]: CALM },
    });
    expect(action).toBeNull();
  });

  it('the drive itself is unchanged (additive — no behaviour drift)', () => {
    // Sanity: the loop READS the drive; it does not mutate it. The drive still
    // fires unsatisfied on the surprising snapshot directly.
    expect(FORECAST_SURPRISE_DRIVE.evaluate(SURPRISING, {}).satisfied).toBe(false);
    expect(FORECAST_SURPRISE_DRIVE.evaluate(CALM, {}).satisfied).toBe(true);
    expect(FORECAST_SURPRISE_DRIVE.id).toBe('forecast-surprise');
  });
});

describe('forecast-surprise loop — end-to-end through registry + scheduler', () => {
  it('registers, becomes due on cadence, and schedules a decided action', () => {
    const reg = createLoopRegistry();
    const spec = createForecastSurpriseLoop({ createdAtMs: 0, everyMs: 1000 });
    expect(reg.register(spec).ok).toBe(true);
    // Before cadence → not due.
    expect(scheduleLoops({ registry: reg, nowMs: 500 })).toEqual([]);
    // After cadence WITH a surprising snapshot folded into the port → fires.
    const out = scheduleLoops({
      registry: reg,
      nowMs: 2000,
      ports: { [SITUATIONAL_SNAPSHOT_PORT]: SURPRISING },
    });
    expect(out.map((f) => f.loop.id)).toEqual([FORECAST_SURPRISE_LOOP_ID]);
    expect(out[0]?.action?.actPort).toBe(FORECAST_SURPRISE_ACT_PORT);
  });

  it('after cadence with a CALM snapshot the loop does not fire (evaluate gates)', () => {
    const reg = createLoopRegistry();
    reg.register(createForecastSurpriseLoop({ createdAtMs: 0, everyMs: 1000 }));
    const out = scheduleLoops({
      registry: reg,
      nowMs: 2000,
      ports: { [SITUATIONAL_SNAPSHOT_PORT]: CALM },
    });
    expect(out).toEqual([]);
  });
});
