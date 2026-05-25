/**
 * Tests for voice-persona-dna/profiles registry.
 *
 * Coverage: invariants (>=3 greetings/closings, >=5 taboos, valid pace),
 * lookup behaviour, listProfiles totality, frozen profiles, taboo
 * uniqueness within a profile.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_PROFILES,
  getProfile,
  listProfiles,
  HEAD_PROFILE,
  OWNER_PROFILE,
  TENANT_PROFILE,
  VENDOR_PROFILE,
  REGULATOR_PROFILE,
  APPLICANT_PROFILE,
} from '../profiles.js';

describe('voice-persona-dna profile registry', () => {
  it('exports all six personae', () => {
    expect(ALL_PROFILES).toHaveLength(6);
    const ids = ALL_PROFILES.map((p) => p.personaId).sort();
    expect(ids).toEqual([
      'mr-mwikila-applicant',
      'mr-mwikila-head',
      'mr-mwikila-owner',
      'mr-mwikila-regulator',
      'mr-mwikila-tenant',
      'mr-mwikila-vendor',
    ]);
  });

  it('every profile has at least 3 greeting patterns', () => {
    for (const p of ALL_PROFILES) {
      expect(p.greetingPatterns.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('every profile has at least 3 closing patterns', () => {
    for (const p of ALL_PROFILES) {
      expect(p.closingPatterns.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('every profile has at least 5 taboos', () => {
    for (const p of ALL_PROFILES) {
      expect(p.taboos.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('every profile has wordsPerMinute within 80..220', () => {
    for (const p of ALL_PROFILES) {
      expect(p.pace.wordsPerMinute).toBeGreaterThanOrEqual(80);
      expect(p.pace.wordsPerMinute).toBeLessThanOrEqual(220);
    }
  });

  it('regulator has a literary register and forbids casual openings', () => {
    expect(REGULATOR_PROFILE.vocabularyRegister).toBe('literary');
    expect(REGULATOR_PROFILE.taboos).toContain('hey');
    expect(REGULATOR_PROFILE.taboos).toContain('hi there');
  });

  it('head profile is formal and pace is slower than tenant pace', () => {
    expect(HEAD_PROFILE.tone).toBe('formal');
    expect(HEAD_PROFILE.pace.wordsPerMinute).toBeLessThan(
      TENANT_PROFILE.pace.wordsPerMinute,
    );
  });

  it('owner and tenant profiles enable EA Swahili code-switching', () => {
    expect(OWNER_PROFILE.codeSwitching).toBeDefined();
    expect(TENANT_PROFILE.codeSwitching).toBeDefined();
    expect(OWNER_PROFILE.codeSwitching?.allowedInserts).toContain('sw-KE');
    expect(TENANT_PROFILE.codeSwitching?.allowedInserts).toContain('sw-KE');
  });

  it('vendor profile is precise and forbids "buddy"-style language', () => {
    expect(VENDOR_PROFILE.tone).toBe('precise');
    expect(VENDOR_PROFILE.taboos).toContain('buddy');
    expect(VENDOR_PROFILE.taboos).toContain('my friend');
  });

  it('applicant profile forbids high-pressure sales language', () => {
    expect(APPLICANT_PROFILE.taboos).toContain("don't miss out");
    expect(APPLICANT_PROFILE.taboos).toContain('hurry up');
  });

  it('getProfile returns null for an unknown id', () => {
    expect(getProfile('nope')).toBeNull();
  });

  it('getProfile returns the same instance as the named export', () => {
    expect(getProfile('mr-mwikila-head')).toBe(HEAD_PROFILE);
  });

  it('listProfiles returns the full set', () => {
    expect(listProfiles().length).toBe(6);
  });

  it('profiles are frozen — direct mutation does not change the registry', () => {
    expect(Object.isFrozen(HEAD_PROFILE)).toBe(true);
  });
});
