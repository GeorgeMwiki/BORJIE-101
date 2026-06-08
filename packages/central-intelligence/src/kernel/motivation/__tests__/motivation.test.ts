/**
 * Motivation subsystem tests (Wave 1).
 *
 * Covers the core invariant: an UNSATISFIED standing drive GENERATES a goal
 * with NO incoming trigger; a satisfied estate yields zero goals; goals
 * coalesce on a stable drive-keyed id; missing data never raises a concern.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemorySituationalModelStore,
  createSituationalModel,
} from '../../situational-model/index.js';
import { createMotivationEngine, DEFAULT_DRIVE_THRESHOLDS } from '../index.js';

const T = 'tenant-A';

async function snapshotWith(
  rows: ReadonlyArray<{ entityId: string; kind: 'cash' | 'licence' | 'site' | 'equipment' | 'arrears' | 'counterparty'; attributes: Record<string, unknown> }>,
) {
  const store = createInMemorySituationalModelStore({ now: () => 1000 });
  const model = createSituationalModel({ store, now: () => 1000 });
  for (const r of rows) {
    await model.observe({
      tenantId: T,
      entityId: r.entityId,
      kind: r.kind,
      label: r.entityId,
      attributes: r.attributes,
    });
  }
  return model.snapshot(T);
}

describe('motivation — unsatisfied drive emits a goal with no trigger', () => {
  it('cash runway below floor formulates a cash-runway goal', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 12 } },
    ]);
    const engine = createMotivationEngine({ now: () => 2000 });
    const goals = engine.formulateGoals(snap);
    expect(goals).toHaveLength(1);
    expect(goals[0]?.driveId).toBe('cash-runway');
    expect(goals[0]?.id).toBe('drive:cash-runway'); // stable dedupe key
    expect(goals[0]?.evidence[0]?.entity.entityId).toBe('cash-1');
    expect(goals[0]?.formulatedAtMs).toBe(2000);
  });

  it('licence inside its renewal lead-time formulates a licence goal', async () => {
    const snap = await snapshotWith([
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 9 } },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals.map((g) => g.driveId)).toContain('licence-currency');
  });

  it('any open safety incident breaches the default-zero ceiling', async () => {
    const snap = await snapshotWith([
      { entityId: 'site-1', kind: 'site', attributes: { openIncidents: 1 } },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals.map((g) => g.driveId)).toContain('safety');
  });

  it('multiple breaches are returned highest-severity-first', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 1 } }, // deep breach
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 29 } }, // mild
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals.length).toBeGreaterThanOrEqual(2);
    expect(goals[0]!.breachSeverity).toBeGreaterThanOrEqual(goals[1]!.breachSeverity);
  });
});

describe('motivation — a satisfied estate is silent', () => {
  it('healthy measurements formulate zero goals', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 120 } },
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
      { entityId: 'site-1', kind: 'site', attributes: { openIncidents: 0 } },
      { entityId: 'eq-1', kind: 'equipment', attributes: { healthScore: 0.9 } },
      { entityId: 'arr-1', kind: 'arrears', attributes: { overdueDays: 0 } },
      { entityId: 'cp-1', kind: 'counterparty', attributes: { offtakeCoverageRatio: 1 } },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals).toHaveLength(0);
  });

  it('MISSING data never raises a concern (no spam from absent measurements)', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: {} }, // no runwayDays
      { entityId: 'lic-1', kind: 'licence', attributes: {} }, // no renewalInDays
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals).toHaveLength(0);
  });
});

describe('motivation — tenant-configurable thresholds', () => {
  it('a custom floor changes the satisfaction boundary', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 45 } },
    ]);
    // default floor 30 → satisfied
    expect(createMotivationEngine().formulateGoals(snap)).toHaveLength(0);
    // raise floor to 60 → now breached
    const strict = createMotivationEngine({
      thresholds: { ...DEFAULT_DRIVE_THRESHOLDS, cashRunwayDaysFloor: 60 },
    });
    expect(strict.formulateGoals(snap).map((g) => g.driveId)).toContain('cash-runway');
  });
});
