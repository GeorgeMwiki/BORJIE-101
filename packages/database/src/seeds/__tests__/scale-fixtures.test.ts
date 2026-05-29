import { describe, expect, it } from 'vitest';

import {
  ALL_SCALE_FIXTURES,
  T1_ARTISANAL_FIXTURE,
  T2_COOPERATIVE_FIXTURE,
  T3_MIDTIER_FIXTURE,
  T4_INDUSTRIAL_FIXTURE,
  T5_GROUP_FIXTURE,
  type ScaleFixture,
  type ScaleTier,
} from '../scale-fixtures/index.js';

// ─── Local mirror of `autoDetectScaleTier` ──────────────────────────
// We re-implement the helper here so this test does not pull in
// `@borjie/owner-os-tabs` as a database-package runtime dependency. A
// matching test in `packages/owner-os-tabs/src/__tests__/scale-defaults
// .test.ts` covers the canonical implementation; this one covers fixture
// classification only.

function autoDetectMirror(s: {
  workerCount: number;
  siteCount: number;
  crossBorder: boolean;
}): ScaleTier {
  if (s.crossBorder) return 't5_multi_country';
  if (s.workerCount > 500) return 't4_industrial';
  if (s.workerCount > 50 || s.siteCount > 4) return 't3_midtier';
  if (s.workerCount > 5 || s.siteCount > 1) return 't2_cooperative';
  return 't1_artisanal';
}

describe('scale-fixtures', () => {
  it('exposes all five fixtures via ALL_SCALE_FIXTURES', () => {
    expect(ALL_SCALE_FIXTURES).toHaveLength(5);
    expect(ALL_SCALE_FIXTURES.map((f) => f.tier)).toEqual([
      't1_artisanal',
      't2_cooperative',
      't3_midtier',
      't4_industrial',
      't5_multi_country',
    ]);
  });

  it.each(ALL_SCALE_FIXTURES.map((f) => [f.tier, f] as const))(
    '%s: autoDetect classifies the fixture as its declared tier',
    (_tier, fixture) => {
      const detected = autoDetectMirror({
        workerCount: fixture.scaleSignals.workerCount,
        siteCount: fixture.scaleSignals.siteCount,
        crossBorder: fixture.scaleSignals.crossBorder,
      });
      expect(detected).toBe(fixture.tier);
    },
  );

  it.each(ALL_SCALE_FIXTURES.map((f) => [f.tier, f] as const))(
    '%s: every employee references a real site',
    (_tier, fixture) => {
      const siteIds = new Set(fixture.sites.map((s) => s.id));
      for (const emp of fixture.employees) {
        expect(siteIds.has(emp.siteId), `${fixture.tier}:${emp.id}`).toBe(true);
      }
    },
  );

  it.each(ALL_SCALE_FIXTURES.map((f) => [f.tier, f] as const))(
    '%s: every site declares a valid phase',
    (_tier, fixture) => {
      const validPhases = new Set([
        'exploration',
        'extraction',
        'rehabilitation',
      ]);
      for (const s of fixture.sites) {
        expect(validPhases.has(s.phase)).toBe(true);
      }
    },
  );

  it.each(ALL_SCALE_FIXTURES.map((f) => [f.tier, f] as const))(
    '%s: bilingual blurbs are present',
    (_tier, fixture) => {
      expect(fixture.blurbEn.length).toBeGreaterThan(0);
      expect(fixture.blurbSw.length).toBeGreaterThan(0);
    },
  );

  it('T1 artisanal is a 1-worker single-pit owner-operator', () => {
    expect(T1_ARTISANAL_FIXTURE.scaleSignals.workerCount).toBe(1);
    expect(T1_ARTISANAL_FIXTURE.scaleSignals.siteCount).toBe(1);
    expect(T1_ARTISANAL_FIXTURE.employees).toHaveLength(1);
    expect(T1_ARTISANAL_FIXTURE.sites).toHaveLength(1);
  });

  it('T2 cooperative has 3 pits + 22 workers', () => {
    expect(T2_COOPERATIVE_FIXTURE.scaleSignals.workerCount).toBe(22);
    expect(T2_COOPERATIVE_FIXTURE.sites).toHaveLength(3);
  });

  it('T3 midtier has 5 sites + 180 workers', () => {
    expect(T3_MIDTIER_FIXTURE.scaleSignals.workerCount).toBe(180);
    expect(T3_MIDTIER_FIXTURE.sites).toHaveLength(5);
  });

  it('T4 industrial has 8 sites + 1200 workers', () => {
    expect(T4_INDUSTRIAL_FIXTURE.scaleSignals.workerCount).toBe(1_200);
    expect(T4_INDUSTRIAL_FIXTURE.sites).toHaveLength(8);
  });

  it('T5 multi-country group flags crossBorder=true', () => {
    expect(T5_GROUP_FIXTURE.scaleSignals.crossBorder).toBe(true);
  });

  it('tenant ids are unique across fixtures (no collisions)', () => {
    const ids = ALL_SCALE_FIXTURES.map((f: ScaleFixture) => f.tenantId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
