/**
 * Profile registry tests — Wave 28.
 *
 * Pins shape + invariants of every persona. If a future edit silently
 * drops a greeting or adds a casual taboo to the regulator persona,
 * these tests fail fast.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_PROFILES,
  HEAD_PROFILE,
  OWNER_PROFILE,
  TENANT_PROFILE,
  VENDOR_PROFILE,
  REGULATOR_PROFILE,
  APPLICANT_PROFILE,
  getProfile,
  listProfiles,
} from '../profiles.js';

describe('voice-persona-dna — profiles registry', () => {
  it('registers exactly six personae', () => {
    expect(ALL_PROFILES.length).toBe(6);
  });

  it('each persona has a unique personaId', () => {
    const ids = ALL_PROFILES.map((p) => p.personaId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every persona has >= 3 greetings, >= 3 closings, >= 5 taboos', () => {
    for (const p of ALL_PROFILES) {
      expect(p.greetingPatterns.length).toBeGreaterThanOrEqual(3);
      expect(p.closingPatterns.length).toBeGreaterThanOrEqual(3);
      expect(p.taboos.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('getProfile returns null for unknown personaId', () => {
    expect(getProfile('not-a-real-persona')).toBeNull();
  });

  it('getProfile returns the pinned object for a known id', () => {
    expect(getProfile('mr-mwikila-head')).toBe(HEAD_PROFILE);
    expect(getProfile('mr-mwikila-owner')).toBe(OWNER_PROFILE);
    expect(getProfile('mr-mwikila-tenant')).toBe(TENANT_PROFILE);
    expect(getProfile('mr-mwikila-vendor')).toBe(VENDOR_PROFILE);
    expect(getProfile('mr-mwikila-regulator')).toBe(REGULATOR_PROFILE);
    expect(getProfile('mr-mwikila-applicant')).toBe(APPLICANT_PROFILE);
  });

  it('listProfiles() returns the ALL_PROFILES registry', () => {
    expect(listProfiles()).toEqual(ALL_PROFILES);
  });

  it('regulator profile uses literary register with no colloquialism', () => {
    expect(REGULATOR_PROFILE.vocabularyRegister).toBe('literary');
    expect(REGULATOR_PROFILE.tone).toBe('formal');
    expect(
      REGULATOR_PROFILE.taboos.some((t) => t === 'hey' || t === 'hi there'),
    ).toBe(true);
  });

  it('tenant profile code-switches into Swahili for EA rapport', () => {
    expect(TENANT_PROFILE.codeSwitching).toBeDefined();
    expect(TENANT_PROFILE.codeSwitching?.allowedInserts).toContain('sw-KE');
    expect(TENANT_PROFILE.codeSwitching?.allowedInserts).toContain('sw-TZ');
  });

  it('vendor profile has no code-switching rules', () => {
    expect(VENDOR_PROFILE.codeSwitching).toBeUndefined();
  });

  it('head profile runs at the specified 155 WPM with medium pauses', () => {
    expect(HEAD_PROFILE.pace.wordsPerMinute).toBe(155);
    expect(HEAD_PROFILE.pace.pausesAfterSentence).toBe('medium');
  });

  it('profile objects are frozen — cannot be mutated at runtime', () => {
    expect(Object.isFrozen(HEAD_PROFILE)).toBe(true);
    expect(Object.isFrozen(OWNER_PROFILE)).toBe(true);
    expect(Object.isFrozen(TENANT_PROFILE)).toBe(true);
    expect(Object.isFrozen(VENDOR_PROFILE)).toBe(true);
    expect(Object.isFrozen(REGULATOR_PROFILE)).toBe(true);
    expect(Object.isFrozen(APPLICANT_PROFILE)).toBe(true);
  });
});
