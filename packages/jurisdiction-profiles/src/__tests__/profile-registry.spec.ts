/**
 * Profile registry tests — CRUD, lookup, immutability, validation.
 */

import { describe, it, expect } from 'vitest';

import type { JurisdictionProfile } from '../types.js';
import {
  emptyProfileRegistry,
  findProfile,
  findProfilesByDataProtectionLaw,
  findProfilesByLanguagePack,
  findProfilesByResidencyKind,
  listProfileIds,
  registerProfile,
  registerProfiles,
  requireProfile,
} from '../registry/profile-registry.js';
import { linkRegistryRow } from '../registry/audit-link.js';

function makeProfile(over: Partial<JurisdictionProfile> = {}): JurisdictionProfile {
  const base: JurisdictionProfile = {
    id: 'tz',
    iso_country: 'TZ',
    display_name: 'Tanzania',
    data_protection_laws: ['tz_dpa_2022'],
    data_residency_kind: 'strict-in-country',
    breach_deadline_hours: 72,
    rtbf_cascade_scope: 'tz-dpa-broad',
    currency_code: 'TZS',
    phone_e164_cc: '255',
    phone_e164_pattern: '^\\d{9}$',
    address_format: {
      lines: ['line1', 'region', 'district', 'ward', 'postal_code'],
      required: ['line1', 'region', 'district'],
    },
    holiday_calendar_key: 'TZ',
    working_week: [1, 2, 3, 4, 5],
    timezone_default: 'Africa/Dar_es_Salaam',
    quiet_hours_default: { start: '18:00', end: '06:00' },
    tax_matrix: { vat: 0.18 },
    language_pack_codes: ['sw', 'en'],
    vertical_profile_codes: ['mining-tz'],
    profile_source_url: 'https://www.pdpc.go.tz/',
    profile_source_title: 'TZ Personal Data Protection Commission',
    profile_source_date: '2023-05-01',
    audit_hash: linkRegistryRow({ kind: 'profile', id: 'tz' }),
  };
  return { ...base, ...over };
}

describe('profile-registry CRUD', () => {
  it('starts empty', () => {
    const reg = emptyProfileRegistry();
    expect(listProfileIds(reg)).toHaveLength(0);
  });

  it('register returns a NEW registry (immutability)', () => {
    const reg0 = emptyProfileRegistry();
    const profile = makeProfile();
    const reg1 = registerProfile(reg0, profile);
    expect(listProfileIds(reg0)).toHaveLength(0);
    expect(listProfileIds(reg1)).toEqual(['tz']);
    expect(reg0).not.toBe(reg1);
  });

  it('find returns the registered profile', () => {
    const reg = registerProfile(emptyProfileRegistry(), makeProfile());
    const found = findProfile(reg, 'tz');
    expect(found).toBeDefined();
    expect(found?.iso_country).toBe('TZ');
  });

  it('requireProfile throws when id not present', () => {
    const reg = emptyProfileRegistry();
    expect(() => requireProfile(reg, 'tz')).toThrowError(/profile_not_registered/);
  });

  it('duplicate id is rejected', () => {
    const reg = registerProfile(emptyProfileRegistry(), makeProfile());
    expect(() => registerProfile(reg, makeProfile())).toThrowError(
      /profile_already_registered/,
    );
  });

  it('invalid id pattern is rejected by zod', () => {
    expect(() =>
      registerProfile(
        emptyProfileRegistry(),
        makeProfile({ id: 'INVALID' as unknown as JurisdictionProfile['id'] }),
      ),
    ).toThrow();
  });

  it('lookup by data-protection-law returns all matching profiles', () => {
    const reg = registerProfiles(emptyProfileRegistry(), [
      makeProfile({ id: 'tz', data_protection_laws: ['tz_dpa_2022'] }),
      makeProfile({
        id: 'ke',
        iso_country: 'KE',
        display_name: 'Kenya',
        data_protection_laws: ['ke_dpa_2019'],
        currency_code: 'KES',
        phone_e164_cc: '254',
        timezone_default: 'Africa/Nairobi',
        holiday_calendar_key: 'KE',
        rtbf_cascade_scope: 'kenya-narrowed-to-false-misleading',
        audit_hash: linkRegistryRow({ kind: 'profile', id: 'ke' }),
      }),
      makeProfile({
        id: 'de',
        iso_country: 'DE',
        display_name: 'Germany',
        data_protection_laws: ['gdpr'],
        regional_bloc: 'eu-eea',
        data_residency_kind: 'regional-bloc',
        currency_code: 'EUR',
        phone_e164_cc: '49',
        timezone_default: 'Europe/Berlin',
        holiday_calendar_key: 'DE',
        language_pack_codes: ['de', 'en'],
        rtbf_cascade_scope: 'gdpr-broad',
        vertical_profile_codes: [],
        audit_hash: linkRegistryRow({ kind: 'profile', id: 'de' }),
      }),
    ]);
    const tzMatches = findProfilesByDataProtectionLaw(reg, 'tz_dpa_2022');
    expect(tzMatches).toHaveLength(1);
    expect(tzMatches[0]?.id).toBe('tz');

    const gdprMatches = findProfilesByDataProtectionLaw(reg, 'gdpr');
    expect(gdprMatches).toHaveLength(1);
    expect(gdprMatches[0]?.id).toBe('de');
  });

  it('lookup by language pack returns matching profiles', () => {
    const reg = registerProfiles(emptyProfileRegistry(), [
      makeProfile(),
      makeProfile({
        id: 'ke',
        iso_country: 'KE',
        display_name: 'Kenya',
        data_protection_laws: ['ke_dpa_2019'],
        currency_code: 'KES',
        phone_e164_cc: '254',
        timezone_default: 'Africa/Nairobi',
        holiday_calendar_key: 'KE',
        rtbf_cascade_scope: 'kenya-narrowed-to-false-misleading',
        language_pack_codes: ['sw', 'en'],
        audit_hash: linkRegistryRow({ kind: 'profile', id: 'ke' }),
      }),
    ]);
    const swMatches = findProfilesByLanguagePack(reg, 'sw');
    expect(swMatches.map((p) => p.id).sort()).toEqual(['ke', 'tz']);
  });

  it('lookup by residency kind returns matching profiles', () => {
    const reg = registerProfiles(emptyProfileRegistry(), [
      makeProfile(),
      makeProfile({
        id: 'de',
        iso_country: 'DE',
        display_name: 'Germany',
        data_protection_laws: ['gdpr'],
        regional_bloc: 'eu-eea',
        data_residency_kind: 'regional-bloc',
        currency_code: 'EUR',
        phone_e164_cc: '49',
        timezone_default: 'Europe/Berlin',
        holiday_calendar_key: 'DE',
        language_pack_codes: ['de'],
        rtbf_cascade_scope: 'gdpr-broad',
        audit_hash: linkRegistryRow({ kind: 'profile', id: 'de' }),
      }),
    ]);
    const strict = findProfilesByResidencyKind(reg, 'strict-in-country');
    expect(strict.map((p) => p.id)).toEqual(['tz']);
    const bloc = findProfilesByResidencyKind(reg, 'regional-bloc');
    expect(bloc.map((p) => p.id)).toEqual(['de']);
  });
});
