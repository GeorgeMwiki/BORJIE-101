/**
 * Situational-model tests (Wave 1, organ #2).
 *
 * Covers:
 *   - persistence/fold: recording the same entity preserves the ACT-R
 *     reference series (frequency + first-referenced span), never overwrites;
 *   - activation/decay: base-level activation rises with frequency and FALLS
 *     with elapsed time (recency decay) — the salience is a computed field;
 *   - spreading: an association lights up a related in-model entity;
 *   - snapshot/broadcast: the most-salient entity is the single GWT broadcast;
 *   - tenant isolation: one tenant never sees another's rows.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemorySituationalModelStore,
  createSituationalModel,
  baseLevelActivation,
  entityKeyOf,
  DEFAULT_ACTIVATION_PARAMS,
  type RecordEntityInput,
} from '../index.js';

const T = 'tenant-A';
const HOUR = 60 * 60 * 1000;

function obs(over: Partial<RecordEntityInput>): RecordEntityInput {
  return {
    tenantId: T,
    entityId: 'lic-1',
    kind: 'licence',
    label: 'Geita licence',
    attributes: { renewalInDays: 9 },
    ...over,
  };
}

describe('situational-model — fold preserves the ACT-R reference series', () => {
  it('records first observation with referenceCount 1', async () => {
    let t = 1_000_000;
    const store = createInMemorySituationalModelStore({ now: () => t });
    const row = await store.record(obs({ observedAtMs: t }));
    expect(row.referenceCount).toBe(1);
    expect(row.firstReferencedAtMs).toBe(t);
    expect(row.lastReferencedAtMs).toBe(t);
  });

  it('re-recording bumps frequency + recency, keeps first-referenced, merges attrs', async () => {
    let t = 1_000_000;
    const store = createInMemorySituationalModelStore({ now: () => t });
    await store.record(obs({ observedAtMs: t, attributes: { renewalInDays: 30 } }));
    t += HOUR;
    const row = await store.record(
      obs({ observedAtMs: t, attributes: { renewalInDays: 9 } }),
    );
    expect(row.referenceCount).toBe(2);
    expect(row.firstReferencedAtMs).toBe(1_000_000); // preserved
    expect(row.lastReferencedAtMs).toBe(t); // advanced
    // newest measurement wins, but the row is NOT blind-overwritten
    expect(row.attributes.renewalInDays).toBe(9);
  });

  it('an out-of-order older observation still counts but never rewinds recency', async () => {
    let t = 10 * HOUR;
    const store = createInMemorySituationalModelStore({ now: () => t });
    await store.record(obs({ observedAtMs: t }));
    const row = await store.record(obs({ observedAtMs: t - HOUR }));
    expect(row.referenceCount).toBe(2);
    expect(row.lastReferencedAtMs).toBe(t); // recency did not rewind
    expect(row.firstReferencedAtMs).toBe(t - HOUR); // span extended backward
  });
});

describe('situational-model — activation rises with frequency, falls with time', () => {
  it('base-level decays as elapsed time grows (recency)', () => {
    const base = {
      tenantId: T,
      entityId: 'lic-1',
      kind: 'licence' as const,
      label: 'L',
      attributes: {},
      referenceCount: 3,
      firstReferencedAtMs: 0,
      associations: {},
      updatedAtMs: 0,
    };
    const fresh = baseLevelActivation(
      { ...base, lastReferencedAtMs: 100 * HOUR },
      100 * HOUR + 60 * 1000, // 1 minute later
      DEFAULT_ACTIVATION_PARAMS,
    );
    const stale = baseLevelActivation(
      { ...base, lastReferencedAtMs: 100 * HOUR },
      100 * HOUR + 30 * 24 * HOUR, // 30 days later
      DEFAULT_ACTIVATION_PARAMS,
    );
    expect(fresh).toBeGreaterThan(stale);
    expect(Number.isFinite(fresh)).toBe(true);
    expect(Number.isFinite(stale)).toBe(true);
  });

  it('higher frequency yields higher base level at equal recency', () => {
    const common = {
      tenantId: T,
      entityId: 'e',
      kind: 'cash' as const,
      label: 'C',
      attributes: {},
      firstReferencedAtMs: 0,
      lastReferencedAtMs: 10 * HOUR,
      associations: {},
      updatedAtMs: 0,
    };
    const now = 11 * HOUR;
    const low = baseLevelActivation({ ...common, referenceCount: 1 }, now, DEFAULT_ACTIVATION_PARAMS);
    const high = baseLevelActivation({ ...common, referenceCount: 20 }, now, DEFAULT_ACTIVATION_PARAMS);
    expect(high).toBeGreaterThan(low);
  });

  it('degenerate inputs never produce NaN/Infinity', () => {
    const a = baseLevelActivation(
      {
        tenantId: T, entityId: 'e', kind: 'cash', label: 'C', attributes: {},
        referenceCount: 0, firstReferencedAtMs: 0, lastReferencedAtMs: 0,
        associations: {}, updatedAtMs: 0,
      },
      0,
      DEFAULT_ACTIVATION_PARAMS,
    );
    expect(Number.isFinite(a)).toBe(true);
  });
});

describe('situational-model — spreading + snapshot/broadcast', () => {
  it('the most-salient entity is the single GWT broadcast', async () => {
    let t = 5_000_000;
    const store = createInMemorySituationalModelStore({ now: () => t });
    const model = createSituationalModel({ store, now: () => t });

    // cash referenced many times very recently → most salient
    for (let i = 0; i < 5; i++) {
      t += 60 * 1000;
      await model.observe(obs({ entityId: 'cash-1', kind: 'cash', label: 'Cash', attributes: { runwayDays: 12 }, observedAtMs: t }));
    }
    // a licence referenced once long-ago span
    await model.observe(obs({ entityId: 'lic-1', kind: 'licence', observedAtMs: 5_000_000 }));

    const snap = await model.snapshot(T);
    expect(snap.broadcast).not.toBeNull();
    expect(snap.broadcast?.entity.entityId).toBe('cash-1');
    // entities are returned highest-activation first
    expect(snap.entities[0]?.entity.entityId).toBe('cash-1');
  });

  it('an association spreads activation to a related in-model entity', async () => {
    let t = 7_000_000;
    const store = createInMemorySituationalModelStore({ now: () => t });
    const model = createSituationalModel({ store, now: () => t });

    // a source entity present in the model
    await model.observe(obs({ entityId: 'fx-window', kind: 'cash', label: 'FX', attributes: {}, observedAtMs: t }));
    // a licence that points at it
    const withLink = await model.observe(
      obs({
        entityId: 'lic-1',
        kind: 'licence',
        associations: { [entityKeyOf('cash', 'fx-window')]: 2 },
        observedAtMs: t,
      }),
    );
    const snap = await model.snapshot(T);
    const lic = snap.entities.find((e) => e.entity.entityId === 'lic-1');
    expect(lic).toBeDefined();
    expect(lic?.spreading).toBeGreaterThan(0);
    expect(withLink.associations[entityKeyOf('cash', 'fx-window')]).toBe(2);
  });
});

describe('situational-model — tenant isolation', () => {
  it('one tenant never sees another tenant rows', async () => {
    const store = createInMemorySituationalModelStore();
    await store.record(obs({ tenantId: 'A', entityId: 'x' }));
    await store.record(obs({ tenantId: 'B', entityId: 'y' }));
    const a = await store.list('A');
    const b = await store.list('B');
    expect(a.map((e) => e.entityId)).toEqual(['x']);
    expect(b.map((e) => e.entityId)).toEqual(['y']);
    expect(await store.get('A', entityKeyOf('licence', 'y'))).toBeNull();
  });
});
