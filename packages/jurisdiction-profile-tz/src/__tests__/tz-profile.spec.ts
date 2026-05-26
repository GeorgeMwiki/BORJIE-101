/**
 * Tanzania jurisdiction profile completeness tests.
 *
 * Verifies the launch-beachhead profile meets every FOUNDER_LOCKED
 * default + UNIVERSAL_JURISDICTION_SPEC requirement:
 * - currency TZS, phone +255, timezone Africa/Dar_es_Salaam
 * - language packs [sw, en], vertical [mining-tz]
 * - quiet hours 18:00–06:00
 * - all four regulators (TRA, Tumemadini, NEMC, BoT) present + valid
 * - profile passes JurisdictionProfileSchema validation
 * - all regulator rows pass RegulatorDefinitionSchema validation
 */

import { describe, it, expect } from 'vitest';

import {
  JurisdictionProfileSchema,
  RegulatorDefinitionSchema,
  emptyProfileRegistry,
  emptyRegulatorRegistry,
  findRegulator,
  findRegulatorsByDomain,
  findRegulatorsForJurisdiction,
  registerProfile,
  registerRegulators,
  requireProfile,
} from '@borjie/jurisdiction-profiles';

import {
  tzBot,
  tzNemc,
  tzProfile,
  tzRegulators,
  tzTra,
  tzTumemadini,
} from '../tz-profile.js';

describe('TZ profile completeness', () => {
  it('passes JurisdictionProfileSchema validation', () => {
    const parsed = JurisdictionProfileSchema.parse(tzProfile);
    expect(parsed.id).toBe('tz');
  });

  it('id = tz and iso_country = TZ', () => {
    expect(tzProfile.id).toBe('tz');
    expect(tzProfile.iso_country).toBe('TZ');
  });

  it('data_protection_laws includes tz_dpa_2022', () => {
    expect(tzProfile.data_protection_laws).toContain('tz_dpa_2022');
  });

  it('data_residency_kind = strict-in-country', () => {
    expect(tzProfile.data_residency_kind).toBe('strict-in-country');
  });

  it('breach_deadline_hours = 72 (aligned with GDPR)', () => {
    expect(tzProfile.breach_deadline_hours).toBe(72);
  });

  it('currency = TZS', () => {
    expect(tzProfile.currency_code).toBe('TZS');
  });

  it('phone E.164 country code = 255', () => {
    expect(tzProfile.phone_e164_cc).toBe('255');
  });

  it('timezone = Africa/Dar_es_Salaam (IANA tz database)', () => {
    expect(tzProfile.timezone_default).toBe('Africa/Dar_es_Salaam');
  });

  it('language packs = [sw, en]', () => {
    expect([...tzProfile.language_pack_codes].sort()).toEqual(['en', 'sw']);
  });

  it('vertical profile = mining-tz', () => {
    expect(tzProfile.vertical_profile_codes).toContain('mining-tz');
  });

  it('quiet hours match FOUNDER_LOCKED defaults 18:00–06:00', () => {
    expect(tzProfile.quiet_hours_default.start).toBe('18:00');
    expect(tzProfile.quiet_hours_default.end).toBe('06:00');
  });

  it('working week is Monday–Friday (ISO 1..5)', () => {
    expect(tzProfile.working_week).toEqual([1, 2, 3, 4, 5]);
  });

  it('VAT standard rate = 18% per TRA VAT', () => {
    expect((tzProfile.tax_matrix as Record<string, unknown>)['vat_standard_rate']).toBe(0.18);
  });

  it('carries citation URL + title + date', () => {
    expect(tzProfile.profile_source_url).toMatch(/^https?:\/\//);
    expect(tzProfile.profile_source_title.length).toBeGreaterThan(0);
    expect(tzProfile.profile_source_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('registers cleanly into the profile registry', () => {
    const reg = registerProfile(emptyProfileRegistry(), tzProfile);
    expect(requireProfile(reg, 'tz').id).toBe('tz');
  });
});

describe('TZ regulators completeness', () => {
  it('exactly four launch regulators', () => {
    expect(tzRegulators).toHaveLength(4);
  });

  it('includes TRA + Tumemadini + NEMC + BoT', () => {
    const ids = tzRegulators.map((r) => r.id).sort();
    expect(ids).toEqual(['tz-bot', 'tz-nemc', 'tz-tra', 'tz-tumemadini']);
  });

  it('each regulator passes RegulatorDefinitionSchema', () => {
    for (const r of tzRegulators) {
      const parsed = RegulatorDefinitionSchema.parse(r);
      expect(parsed.jurisdiction_id).toBe('tz');
    }
  });

  it('each regulator has at least one filing kind with a source URL', () => {
    for (const r of tzRegulators) {
      expect(r.filing_kinds.length).toBeGreaterThan(0);
      const withSource = r.filing_kinds.filter((fk) => fk.source_url !== undefined);
      expect(withSource.length).toBeGreaterThan(0);
    }
  });

  it('TRA has VAT monthly return due on day 20', () => {
    const vat = tzTra.filing_kinds.find((fk) => fk.kind === 'vat-return');
    expect(vat?.due_day_of_month).toBe(20);
    expect(vat?.cadence).toBe('monthly');
  });

  it('Tumemadini royalty is per-transaction before clearance', () => {
    const royalty = tzTumemadini.filing_kinds.find((fk) => fk.kind === 'royalty-payment');
    expect(royalty?.cadence).toBe('per-transaction');
  });

  it('NEMC EIA application is pre-project', () => {
    const eia = tzNemc.filing_kinds.find((fk) => fk.kind === 'eia-certificate-application');
    expect(eia?.cadence).toBe('pre-project');
  });

  it('BoT national gold/gemstone reserve deposit is event-driven', () => {
    const reserve = tzBot.filing_kinds.find(
      (fk) => fk.kind === 'national-gold-gemstone-reserve-deposit',
    );
    expect(reserve?.cadence).toBe('event-driven');
  });

  it('registers cleanly into the regulator registry', () => {
    const reg = registerRegulators(emptyRegulatorRegistry(), tzRegulators);
    expect(findRegulator(reg, 'tz-tra')).toBeDefined();
    expect(findRegulator(reg, 'tz-tumemadini')).toBeDefined();
    expect(findRegulator(reg, 'tz-nemc')).toBeDefined();
    expect(findRegulator(reg, 'tz-bot')).toBeDefined();
  });

  it('findRegulatorsForJurisdiction(tz) returns all four', () => {
    const reg = registerRegulators(emptyRegulatorRegistry(), tzRegulators);
    const found = findRegulatorsForJurisdiction(reg, 'tz');
    expect(found).toHaveLength(4);
  });

  it('findRegulatorsByDomain(mining) returns tz-tumemadini', () => {
    const reg = registerRegulators(emptyRegulatorRegistry(), tzRegulators);
    const mining = findRegulatorsByDomain(reg, 'mining');
    expect(mining.map((r) => r.id)).toContain('tz-tumemadini');
  });
});
