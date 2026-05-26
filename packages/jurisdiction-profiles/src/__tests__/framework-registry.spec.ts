/**
 * Framework registry tests — registration, control mappings, lookups.
 */

import { describe, it, expect } from 'vitest';

import {
  ALL_CONTROL_MAPPINGS,
  ALL_FRAMEWORKS,
} from '../seed/seed-frameworks.js';
import {
  emptyFrameworkRegistry,
  findFramework,
  findFrameworksForJurisdiction,
  findMappingsByControlKind,
  findMappingsForFramework,
  listFrameworkIds,
  registerControlMappings,
  registerFrameworks,
  requireFramework,
} from '../registry/framework-registry.js';

describe('framework-registry seed', () => {
  it('loads all 19 frameworks from the seed', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    expect(listFrameworkIds(reg)).toHaveLength(ALL_FRAMEWORKS.length);
    expect(ALL_FRAMEWORKS.length).toBeGreaterThanOrEqual(16);
  });

  it('contains all required compliance frameworks', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    const required = [
      'gdpr',
      'tz_dpa_2022',
      'ccpa',
      'cpra',
      'lgpd',
      'pipl',
      'pdpa_sg',
      'dpdp_in',
      'ke_dpa_2019',
      'ndpa_2023',
      'popia',
      'kvkk',
      'lfpdppp',
      'pipeda',
      'appi',
      'hipaa',
      'ferpa',
      'coppa',
    ];
    for (const id of required) {
      expect(findFramework(reg, id)).toBeDefined();
    }
  });

  it('each framework carries a citation URL, title, and date', () => {
    for (const fw of ALL_FRAMEWORKS) {
      expect(fw.source_url).toMatch(/^https?:\/\//);
      expect(fw.source_title.length).toBeGreaterThan(0);
      expect(fw.source_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('rejects mapping referencing unknown framework', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    expect(() =>
      registerControlMappings(reg, [
        {
          framework_id: 'does_not_exist',
          article_ref: 'x',
          control_kind: 'breach-notification',
          package_name: 'pkg',
          impl_pointer: 'a/b.ts',
          audit_hash: 'h',
        },
      ]),
    ).toThrowError(/mapping_references_unknown_framework/);
  });

  it('loads all control mappings without duplicates', () => {
    const reg = registerControlMappings(
      registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS),
      ALL_CONTROL_MAPPINGS,
    );
    expect(reg.mappings.size).toBe(ALL_CONTROL_MAPPINGS.length);
  });

  it('control mapping query for breach-notification finds at least 14 mappings', () => {
    const reg = registerControlMappings(
      registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS),
      ALL_CONTROL_MAPPINGS,
    );
    const breach = findMappingsByControlKind(reg, 'breach-notification');
    expect(breach.length).toBeGreaterThanOrEqual(14);
  });

  it('framework control mapping query — find all mappings for GDPR', () => {
    const reg = registerControlMappings(
      registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS),
      ALL_CONTROL_MAPPINGS,
    );
    const gdprMappings = findMappingsForFramework(reg, 'gdpr');
    expect(gdprMappings.length).toBeGreaterThanOrEqual(3);
    const refs = gdprMappings.map((m) => m.article_ref);
    expect(refs).toContain('Art. 33');
    expect(refs).toContain('Art. 17');
    expect(refs).toContain('Art. 32');
  });

  it('findFrameworksForJurisdiction(tz) returns tz_dpa_2022', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    const tz = findFrameworksForJurisdiction(reg, 'tz');
    expect(tz.map((f) => f.id)).toContain('tz_dpa_2022');
  });

  it('findFrameworksForJurisdiction(gb-eng) returns uk_gdpr', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    const gb = findFrameworksForJurisdiction(reg, 'gb-eng');
    expect(gb.map((f) => f.id)).toContain('uk_gdpr');
  });

  it('requireFramework throws on unknown', () => {
    const reg = emptyFrameworkRegistry();
    expect(() => requireFramework(reg, 'does_not_exist')).toThrowError(
      /framework_not_registered/,
    );
  });

  it('GDPR effective date matches 2018-05-25', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    expect(requireFramework(reg, 'gdpr').effective_date).toBe('2018-05-25');
  });

  it('PIPL effective date matches 2021-11-01', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    expect(requireFramework(reg, 'pipl').effective_date).toBe('2021-11-01');
  });

  it('DPDP IN cites 2025-11-13 Rules notification', () => {
    const reg = registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS);
    expect(requireFramework(reg, 'dpdp_in').source_date).toBe('2025-11-13');
  });
});
