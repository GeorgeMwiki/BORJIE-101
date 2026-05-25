/**
 * template-specs.test.ts — Validate every shipped template's spec
 * against the locked DSL grammar from @borjie/module-spec-engine.
 *
 * Pin down the contract: 10 platform built-ins, each with ≥3 entities,
 * ≥2 workflows, ≥3 ui_sections, and the spec must compile cleanly for
 * a synthetic tenant id.
 */

import { describe, it, expect } from 'vitest';
import { validateSpec, compileSpec } from '@borjie/module-spec-engine';
import {
  ALL_TEMPLATE_BUNDLES,
  findBundle,
  estateBundle,
} from '../index.js';

const REQUIRED_SLUGS = [
  'ESTATE',
  'HR',
  'FLEET',
  'PROCUREMENT',
  'LEGAL',
  'FINANCE',
  'STRATEGY',
  'COMPLIANCE',
  'CRM',
  'INVENTORY',
];

describe('ALL_TEMPLATE_BUNDLES', () => {
  it('ships exactly 10 platform-built-in bundles', () => {
    expect(ALL_TEMPLATE_BUNDLES.length).toBe(10);
  });

  it('covers every required slug', () => {
    const slugs = ALL_TEMPLATE_BUNDLES.map((b) => b.slug).sort();
    expect(slugs).toEqual([...REQUIRED_SLUGS].sort());
  });

  it('findBundle returns ESTATE bundle by slug', () => {
    const found = findBundle('ESTATE');
    expect(found).toBeDefined();
    expect(found?.titleEn).toBe('Estate Management');
  });

  it('findBundle returns undefined for an unknown slug', () => {
    expect(findBundle('NOT_A_THING')).toBeUndefined();
  });
});

describe.each(ALL_TEMPLATE_BUNDLES)(
  'template bundle: $slug',
  (bundle) => {
    it('has display metadata in EN + SW', () => {
      expect(bundle.titleEn.length).toBeGreaterThan(0);
      expect(bundle.titleSw.length).toBeGreaterThan(0);
      expect(bundle.description.length).toBeGreaterThan(0);
      expect(bundle.icon.length).toBeGreaterThan(0);
    });

    it('declares ≥3 entities', () => {
      expect(bundle.spec.entities.length).toBeGreaterThanOrEqual(3);
    });

    it('declares ≥2 workflows', () => {
      expect(bundle.spec.workflows.length).toBeGreaterThanOrEqual(2);
    });

    it('declares ≥3 ui_sections', () => {
      expect(bundle.spec.ui_sections.length).toBeGreaterThanOrEqual(3);
    });

    it('passes the locked DSL grammar', () => {
      const result = validateSpec(bundle.spec);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('compiles cleanly for a synthetic tenant', () => {
      const r = compileSpec(bundle.spec, 'tnt_demo');
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
      // At least one CREATE TABLE per entity.
      const tableCount = (r.migrationSql.match(/CREATE TABLE/g) ?? []).length;
      expect(tableCount).toBeGreaterThanOrEqual(bundle.spec.entities.length);
    });

    it('registers ≥1 accept handler', () => {
      expect(bundle.acceptHandlers.length).toBeGreaterThanOrEqual(1);
    });

    it('every handler has valid metadata (action, tiers, risk_tier)', () => {
      for (const h of bundle.acceptHandlers) {
        expect(h.action.length).toBeGreaterThan(0);
        expect(h.handlerModule.length).toBeGreaterThan(0);
        expect(h.allowedPersonaTiers.length).toBeGreaterThan(0);
        for (const t of h.allowedPersonaTiers) {
          expect(t).toBeGreaterThanOrEqual(1);
          expect(t).toBeLessThanOrEqual(5);
        }
        expect(['LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN']).toContain(h.riskTier);
      }
    });
  },
);

describe('ESTATE bundle — handler depth', () => {
  it('ships create_lease_application as the proof-of-concept handler', () => {
    const handler = estateBundle.acceptHandlers.find(
      (h) => h.action === 'create_lease_application',
    );
    expect(handler).toBeDefined();
    expect(handler?.riskTier).toBe('HIGH');
    expect(handler?.emitsMoneyMutation).toBe(true);
    expect(handler?.allowedPersonaTiers).toContain(2);
  });
});
