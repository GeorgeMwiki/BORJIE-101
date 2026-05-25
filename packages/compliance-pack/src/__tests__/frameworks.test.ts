/**
 * Framework catalog + cross-reference helper tests.
 *
 * Invariants asserted:
 *   - Every catalog has >= 5 controls (spec floor).
 *   - Every control id is unique within its catalog.
 *   - Every control declares a non-empty `satisfiedBy`.
 *   - Cross-reference helpers return the expected sets.
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_CATALOGS,
  ALL_CATALOGS_LIST,
  ALL_CONTROL_MAPPINGS,
  catalogByFramework,
  controlsByJurisdiction,
  controlsSatisfiedByFeature,
  featuresSatisfyingControl,
} from '../frameworks/index.js';
import {
  ComplianceFrameworkSchema,
  ControlCatalogSchema,
  ControlSpecSchema,
  COMPLIANCE_FRAMEWORKS,
} from '../types.js';

describe('frameworks: catalog shape', () => {
  it('exposes exactly the 10 declared frameworks', () => {
    expect(Object.keys(ALL_CATALOGS).sort()).toEqual([...COMPLIANCE_FRAMEWORKS].sort());
    expect(ALL_CATALOGS_LIST).toHaveLength(10);
  });

  it.each(ALL_CATALOGS_LIST.map((c) => [c.frameworkId, c] as const))(
    '%s has at least 5 controls and parses its schema',
    (_id, catalog) => {
      expect(catalog.controls.length).toBeGreaterThanOrEqual(5);
      expect(() => ControlCatalogSchema.parse(catalog)).not.toThrow();
      expect(() => ComplianceFrameworkSchema.parse(catalog.frameworkId)).not.toThrow();
    },
  );

  it.each(ALL_CATALOGS_LIST.map((c) => [c.frameworkId, c] as const))(
    '%s control ids are unique and each control parses',
    (_id, catalog) => {
      const ids = catalog.controls.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const control of catalog.controls) {
        expect(() => ControlSpecSchema.parse(control)).not.toThrow();
        expect(control.satisfiedBy.length).toBeGreaterThan(0);
      }
    },
  );
});

describe('frameworks: controlsByJurisdiction', () => {
  it('returns every TZ control across the platform', () => {
    const tz = controlsByJurisdiction('TZ');
    expect(tz.length).toBeGreaterThanOrEqual(5);
    for (const entry of tz) {
      expect(entry.control.jurisdiction).toBe('TZ');
      expect(entry.frameworkId).toBe('tz-dpa');
    }
  });

  it('returns GLOBAL controls (SOC2 + ISO27001 + GDPR/CCPA/etc share none)', () => {
    const global = controlsByJurisdiction('GLOBAL');
    expect(global.length).toBeGreaterThanOrEqual(20);
    const frameworks = new Set(global.map((e) => e.frameworkId));
    expect(frameworks.has('soc2')).toBe(true);
    expect(frameworks.has('iso27001')).toBe(true);
    expect(frameworks.has('gdpr')).toBe(false);
  });

  it('separates EU (GDPR) from ZA (POPIA)', () => {
    const eu = controlsByJurisdiction('EU');
    const za = controlsByJurisdiction('ZA');
    expect(eu.every((e) => e.frameworkId === 'gdpr')).toBe(true);
    expect(za.every((e) => e.frameworkId === 'popia')).toBe(true);
    expect(eu.length).toBeGreaterThan(0);
    expect(za.length).toBeGreaterThan(0);
  });
});

describe('frameworks: controlsSatisfiedByFeature', () => {
  it('inverts to find controls satisfied by encryption package', () => {
    const result = controlsSatisfiedByFeature(
      'packages/compliance-pack/src/encryption',
    );
    expect(result.length).toBeGreaterThanOrEqual(5);
    const frameworks = new Set(result.map((r) => r.frameworkId));
    expect(frameworks.has('soc2')).toBe(true);
    expect(frameworks.has('gdpr')).toBe(true);
    expect(frameworks.has('popia')).toBe(true);
  });

  it('returns empty for unknown feature', () => {
    const result = controlsSatisfiedByFeature('nonexistent-feature-xyz');
    expect(result).toEqual([]);
  });
});

describe('frameworks: featuresSatisfyingControl', () => {
  it('returns features satisfying GDPR Article 17 (right to erasure)', () => {
    const features = featuresSatisfyingControl('Art.17', 'gdpr');
    expect(features).toContain('packages/compliance-pack/src/erasure-cascade');
  });

  it('returns features satisfying SOC2 CC6.6 (encryption)', () => {
    const features = featuresSatisfyingControl('CC6.6', 'soc2');
    expect(features.length).toBeGreaterThan(0);
    expect(features).toContain('packages/compliance-pack/src/encryption');
  });

  it('without framework filter, returns union across catalogs', () => {
    // 'KE.S26.Rights' is unique to KE; verify framework filter is optional
    // and works for an unfiltered call as well.
    const unfiltered = featuresSatisfyingControl('KE.S26.Rights');
    const filtered = featuresSatisfyingControl('KE.S26.Rights', 'ke-dpa');
    expect(unfiltered).toEqual(filtered);
  });
});

describe('frameworks: catalogByFramework', () => {
  it('returns the SOC2 catalog by code', () => {
    const cat = catalogByFramework('soc2');
    expect(cat.frameworkId).toBe('soc2');
    expect(cat.controls.length).toBeGreaterThan(0);
  });
});

describe('frameworks: ALL_CONTROL_MAPPINGS', () => {
  it('aggregates every (framework, control, feature) triple', () => {
    // Expect ALL_CONTROL_MAPPINGS to be larger than just the controls
    // because each control has multiple `satisfiedBy` entries.
    let totalSatisfiedBy = 0;
    for (const catalog of ALL_CATALOGS_LIST) {
      for (const control of catalog.controls) {
        totalSatisfiedBy += control.satisfiedBy.length;
      }
    }
    expect(ALL_CONTROL_MAPPINGS.length).toBe(totalSatisfiedBy);
  });
});
