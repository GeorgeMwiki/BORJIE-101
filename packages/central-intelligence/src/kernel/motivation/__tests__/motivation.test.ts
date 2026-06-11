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
    // The cash-runway breach must formulate its goal. (The ESTATE_VISIBILITY
    // drive also fires here because this minimal snapshot is missing most
    // high-impact entity kinds — that is the curiosity drive working as
    // intended — so assert the cash-runway goal is PRESENT rather than sole.)
    const cashGoal = goals.find((g) => g.driveId === 'cash-runway');
    expect(cashGoal).toBeDefined();
    expect(cashGoal?.id).toBe('drive:cash-runway'); // stable dedupe key
    expect(cashGoal?.evidence[0]?.entity.entityId).toBe('cash-1');
    expect(cashGoal?.formulatedAtMs).toBe(2000);
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
    // The DOMAIN drives stay mute on absent ATTRIBUTES. We give the snapshot
    // full visibility-KIND coverage (cash/licence/counterparty/equipment) so
    // the epistemic `estate-visibility` drive is satisfied too — this test
    // isolates the domain-drive "missing attribute → satisfied" rule, which the
    // visibility drive (fires on missing KINDS, not attributes) does not touch.
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: {} }, // no runwayDays
      { entityId: 'lic-1', kind: 'licence', attributes: {} }, // no renewalInDays
      { entityId: 'cp-1', kind: 'counterparty', attributes: {} }, // no offtake ratio
      { entityId: 'eq-1', kind: 'equipment', attributes: {} }, // no healthScore
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals).toHaveLength(0);
  });
});

describe('motivation — tenant-configurable thresholds', () => {
  it('a custom floor changes the satisfaction boundary', async () => {
    // Full visibility-KIND coverage so the epistemic `estate-visibility` drive
    // stays satisfied — this test isolates the cash-runway FLOOR boundary.
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 45 } },
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
      { entityId: 'cp-1', kind: 'counterparty', attributes: { offtakeCoverageRatio: 1 } },
      { entityId: 'eq-1', kind: 'equipment', attributes: { healthScore: 0.9 } },
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

describe('motivation — estate-visibility (the epistemic / curiosity drive)', () => {
  it('a net-new tenant with NO cash/off-take visibility raises ONE curiosity goal', async () => {
    // Onboards with licences + assets, but no cash forecast and no off-take.
    const snap = await snapshotWith([
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
      { entityId: 'eq-1', kind: 'equipment', attributes: { healthScore: 0.9 } },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    const vis = goals.find((g) => g.driveId === 'estate-visibility');
    expect(vis).toBeDefined();
    // It names the high-impact blind spots (cash + off-take/counterparty)…
    expect(vis!.rationale).toContain('cash');
    expect(vis!.rationale).toContain('counterparty');
    // …and stays mute about the kinds it CAN see.
    expect(vis!.rationale).not.toContain('licence');
    expect(vis!.rationale).not.toContain('equipment');
  });

  it('goes quiet the moment the missing visibility kinds appear', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 120 } },
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
      { entityId: 'cp-1', kind: 'counterparty', attributes: { offtakeCoverageRatio: 1 } },
      { entityId: 'eq-1', kind: 'equipment', attributes: { healthScore: 0.9 } },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals.some((g) => g.driveId === 'estate-visibility')).toBe(false);
  });

  it('coalesces to ONE goal on a stable drive-keyed id (asks once, not per-kind)', async () => {
    const snap = await snapshotWith([
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    const vis = goals.filter((g) => g.driveId === 'estate-visibility');
    expect(vis).toHaveLength(1);
    expect(vis[0]!.id).toBe('drive:estate-visibility');
  });

  it('cites the most-salient OBSERVED entity as provenance (Auditor evidence rail)', async () => {
    const snap = await snapshotWith([
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
    ]);
    const vis = createMotivationEngine()
      .formulateGoals(snap)
      .find((g) => g.driveId === 'estate-visibility');
    expect(vis!.evidence.length).toBeGreaterThanOrEqual(1);
    expect(vis!.evidence[0]!.entity.entityId).toBe('lic-1');
  });
});

describe('motivation — forecast-surprise (predictive-coding salience)', () => {
  it('an entity carrying high surpriseDrift raises a forecast-surprise goal', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 120 } },
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
      { entityId: 'cp-1', kind: 'counterparty', attributes: { offtakeCoverageRatio: 1 } },
      // a divergent reconciliation decorated this asset (drift 0.61 > 0.40 band)
      {
        entityId: 'eq-1',
        kind: 'equipment',
        attributes: { healthScore: 0.9, surpriseDrift: 0.61 },
      },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    const surprise = goals.find((g) => g.driveId === 'forecast-surprise');
    expect(surprise).toBeDefined();
    expect(surprise!.evidence[0]?.entity.entityId).toBe('eq-1');
    expect(surprise!.id).toBe('drive:forecast-surprise');
  });

  it('a drift INSIDE the matched band raises nothing (only divergence is salient)', async () => {
    const snap = await snapshotWith([
      { entityId: 'cash-1', kind: 'cash', attributes: { runwayDays: 120 } },
      { entityId: 'lic-1', kind: 'licence', attributes: { renewalInDays: 200 } },
      { entityId: 'cp-1', kind: 'counterparty', attributes: { offtakeCoverageRatio: 1 } },
      {
        entityId: 'eq-1',
        kind: 'equipment',
        attributes: { healthScore: 0.9, surpriseDrift: 0.1 },
      },
    ]);
    const goals = createMotivationEngine().formulateGoals(snap);
    expect(goals.some((g) => g.driveId === 'forecast-surprise')).toBe(false);
  });
});
