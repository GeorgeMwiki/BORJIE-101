import { describe, expect, it } from 'vitest';

import {
  OWNER_OS_TAB_TYPES,
  SCALE_TIERS,
  SCALE_TIER_LABELS,
  autoDetectScaleTier,
  coerceScaleTier,
  defaultTabsFor,
  scaleTierLabel,
} from '../index.js';

describe('scale-defaults', () => {
  describe('SCALE_TIERS', () => {
    it('exposes the canonical five-tier ladder', () => {
      expect(SCALE_TIERS).toEqual([
        't1_artisanal',
        't2_cooperative',
        't3_midtier',
        't4_industrial',
        't5_multi_country',
      ]);
    });
  });

  describe('defaultTabsFor', () => {
    it('returns the spec sizes per tier (4/7/11/16/20)', () => {
      expect(defaultTabsFor('t1_artisanal')).toHaveLength(4);
      expect(defaultTabsFor('t2_cooperative')).toHaveLength(7);
      expect(defaultTabsFor('t3_midtier')).toHaveLength(11);
      expect(defaultTabsFor('t4_industrial')).toHaveLength(16);
      expect(defaultTabsFor('t5_multi_country')).toHaveLength(20);
    });

    it('every tab id is registered in OWNER_OS_TAB_TYPES', () => {
      const valid = new Set<string>(OWNER_OS_TAB_TYPES);
      for (const tier of SCALE_TIERS) {
        for (const tab of defaultTabsFor(tier)) {
          expect(valid.has(tab), `${tier}:${tab}`).toBe(true);
        }
      }
    });

    it('is additive — each tier is a superset of the previous', () => {
      const t1 = new Set(defaultTabsFor('t1_artisanal'));
      const t2 = new Set(defaultTabsFor('t2_cooperative'));
      const t3 = new Set(defaultTabsFor('t3_midtier'));
      const t4 = new Set(defaultTabsFor('t4_industrial'));
      const t5 = new Set(defaultTabsFor('t5_multi_country'));
      for (const id of t1) expect(t2.has(id)).toBe(true);
      for (const id of t2) expect(t3.has(id)).toBe(true);
      for (const id of t3) expect(t4.has(id)).toBe(true);
      for (const id of t4) expect(t5.has(id)).toBe(true);
    });

    it('returns the same instance shape each call (immutable contract)', () => {
      const a = defaultTabsFor('t3_midtier');
      const b = defaultTabsFor('t3_midtier');
      expect(a).toEqual(b);
      expect(Object.isFrozen(a) || a === defaultTabsFor('t3_midtier')).toBe(true);
    });
  });

  describe('autoDetectScaleTier', () => {
    it('1 worker, 1 site → T1', () => {
      expect(autoDetectScaleTier({ workerCount: 1, siteCount: 1 })).toBe(
        't1_artisanal',
      );
    });

    it('25 workers, 3 sites → T2', () => {
      expect(autoDetectScaleTier({ workerCount: 25, siteCount: 3 })).toBe(
        't2_cooperative',
      );
    });

    it('120 workers, 4 sites → T3', () => {
      expect(autoDetectScaleTier({ workerCount: 120, siteCount: 4 })).toBe(
        't3_midtier',
      );
    });

    it('800 workers → T4', () => {
      expect(autoDetectScaleTier({ workerCount: 800, siteCount: 6 })).toBe(
        't4_industrial',
      );
    });

    it('crossBorder forces T5 regardless of worker count', () => {
      expect(
        autoDetectScaleTier({ workerCount: 8, crossBorder: true }),
      ).toBe('t5_multi_country');
    });

    it('falls back to T1 on empty signals', () => {
      expect(autoDetectScaleTier({})).toBe('t1_artisanal');
    });

    it('many sites with tiny workforce still bumps to T2', () => {
      expect(autoDetectScaleTier({ workerCount: 3, siteCount: 3 })).toBe(
        't2_cooperative',
      );
    });
  });

  describe('coerceScaleTier', () => {
    it('accepts known tier strings', () => {
      expect(coerceScaleTier('t3_midtier')).toBe('t3_midtier');
    });

    it('falls back to t1_artisanal on unknown / null', () => {
      expect(coerceScaleTier(null)).toBe('t1_artisanal');
      expect(coerceScaleTier(undefined)).toBe('t1_artisanal');
      expect(coerceScaleTier('giant')).toBe('t1_artisanal');
    });
  });

  describe('scaleTierLabel', () => {
    it('returns bilingual labels for every tier', () => {
      for (const tier of SCALE_TIERS) {
        const lab = scaleTierLabel(tier);
        expect(lab.tier).toBe(tier);
        expect(lab.labelEn.length).toBeGreaterThan(0);
        expect(lab.labelSw.length).toBeGreaterThan(0);
        expect(lab.descriptionEn.length).toBeGreaterThan(0);
        expect(lab.descriptionSw.length).toBeGreaterThan(0);
      }
    });

    it('SCALE_TIER_LABELS covers every tier exactly once', () => {
      const seen = new Set<string>();
      for (const l of SCALE_TIER_LABELS) {
        expect(seen.has(l.tier)).toBe(false);
        seen.add(l.tier);
      }
      expect(seen.size).toBe(SCALE_TIERS.length);
    });
  });
});
