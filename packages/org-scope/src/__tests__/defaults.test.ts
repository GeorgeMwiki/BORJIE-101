import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINOLOGY,
  DEFAULT_TERMINOLOGY_BY_KEY,
} from '../terminology/defaults.js';
import { TerminologyDefaultSchema } from '../types.js';

describe('DEFAULT_TERMINOLOGY catalogue', () => {
  it('contains at least 40 entries', () => {
    expect(DEFAULT_TERMINOLOGY.length).toBeGreaterThanOrEqual(40);
  });

  it('every entry has en + sw pairs (singular & plural)', () => {
    for (const entry of DEFAULT_TERMINOLOGY) {
      expect(entry.singular_en.length).toBeGreaterThan(0);
      expect(entry.plural_en.length).toBeGreaterThan(0);
      expect(entry.singular_sw.length).toBeGreaterThan(0);
      expect(entry.plural_sw.length).toBeGreaterThan(0);
    }
  });

  it('keys are unique', () => {
    const seen = new Set<string>();
    for (const entry of DEFAULT_TERMINOLOGY) {
      expect(seen.has(entry.key)).toBe(false);
      seen.add(entry.key);
    }
  });

  it('passes the Zod schema for every entry', () => {
    for (const entry of DEFAULT_TERMINOLOGY) {
      const parsed = TerminologyDefaultSchema.safeParse(entry);
      expect(parsed.success).toBe(true);
    }
  });

  it('includes all canonical keys listed in the spec', () => {
    const required = [
      'org_unit',
      'worker',
      'manager',
      'supervisor',
      'parcel',
      'site',
      'shift',
      'incident',
      'contract',
      'buyer',
      'owner',
      'payroll_entry',
      'certification',
      'licence',
      'inspection',
      'assay',
      'drill_hole',
      'fx_position',
      'hedge',
      'kpi',
      'briefing',
      'return',
      'filing',
      'submission',
      'audit',
      'report',
      'evolution_proposal',
      'ui_proposal',
      'doc_proposal',
      'campaign',
      'deal',
      'settlement',
      'marketplace_listing',
      'kyb_record',
      'document',
      'tab',
      'dashboard',
      'home',
      'search',
      'profile',
    ];
    for (const key of required) {
      expect(DEFAULT_TERMINOLOGY_BY_KEY.has(key)).toBe(true);
    }
  });

  it('exposes the lookup map for O(1) reads', () => {
    expect(DEFAULT_TERMINOLOGY_BY_KEY.get('parcel')?.singular_sw).toBe('kifurushi');
    expect(DEFAULT_TERMINOLOGY_BY_KEY.get('nope')).toBeUndefined();
  });
});
