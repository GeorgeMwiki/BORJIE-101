/**
 * JA-3 — Capability jurisdiction overrides tests.
 *
 * Verifies:
 *   - getCapabilityOverride returns null for non-overridden entries
 *   - resolveCapabilityForJurisdiction returns base entry for TZ
 *     (no override needed — TZ is the canonical default)
 *   - resolveCapabilityForJurisdiction returns KE/NG/ZA overrides
 *     for the licence-tracking capability
 *   - PCCB-specific compliance capability resolves to EACC/EFCC/SIU
 *     for the right jurisdictions
 *   - hasJurisdictionOverrides + listCapabilitiesWithOverrides
 *     surface the registry shape
 */

import { describe, it, expect } from 'vitest';

import {
  getCapabilityById,
  getCapabilityOverride,
  hasJurisdictionOverrides,
  listCapabilitiesWithOverrides,
  resolveCapabilityForJurisdiction,
} from '../capabilities/index.js';

describe('JA-3 — capability jurisdiction overrides', () => {
  it('listCapabilitiesWithOverrides returns at least the licence-track + alert + PCCB ids', () => {
    const ids = listCapabilitiesWithOverrides();
    expect(ids).toContain('mwikila.track.licences');
    expect(ids).toContain('mwikila.alert.licence');
    expect(ids).toContain('mwikila.compliance.pccb');
  });

  it('hasJurisdictionOverrides detects overridden vs default entries', () => {
    expect(hasJurisdictionOverrides('mwikila.track.licences')).toBe(true);
    expect(hasJurisdictionOverrides('mwikila.draft.contract')).toBe(false);
  });

  it('returns null for entries without overrides', () => {
    expect(getCapabilityOverride('mwikila.draft.contract', 'KE')).toBeNull();
    expect(getCapabilityOverride('does.not.exist', 'TZ')).toBeNull();
  });

  it('returns null when jurisdiction has no override for a capability', () => {
    // PCCB capability exists, but no UG override
    expect(getCapabilityOverride('mwikila.compliance.pccb', 'UG')).toBeNull();
  });

  it('returns KE override for licence tracking', () => {
    const override = getCapabilityOverride('mwikila.track.licences', 'KE');
    expect(override).not.toBeNull();
    expect(override?.public_description?.en).toContain('State Department of Mining');
    expect(override?.public_description?.en).toContain('Kenya');
  });

  it('case-insensitive country code matching', () => {
    const lower = getCapabilityOverride('mwikila.track.licences', 'ke');
    const upper = getCapabilityOverride('mwikila.track.licences', 'KE');
    expect(lower).toEqual(upper);
  });
});

describe('JA-3 — resolveCapabilityForJurisdiction', () => {
  it('returns base entry untouched for TZ (no override registered)', () => {
    const base = getCapabilityById('mwikila.track.licences');
    expect(base).not.toBeNull();
    const resolved = resolveCapabilityForJurisdiction(base!, 'TZ');
    expect(resolved).toEqual(base);
    expect(resolved.public_description.en).toContain('PML, ML, SML');
  });

  it('rewrites public_description for KE tenant', () => {
    const base = getCapabilityById('mwikila.track.licences');
    expect(base).not.toBeNull();
    const resolved = resolveCapabilityForJurisdiction(base!, 'KE');
    expect(resolved.id).toBe(base!.id);
    expect(resolved.public_description.en).toContain('State Department of Mining');
    expect(resolved.public_description.en).not.toContain('PML, ML, SML');
    // user_outcome is overridden for KE
    expect(resolved.user_outcome).toContain('Mining Office licence');
  });

  it('rewrites public_description for NG tenant (Mining Cadastre Office)', () => {
    const base = getCapabilityById('mwikila.track.licences');
    const resolved = resolveCapabilityForJurisdiction(base!, 'NG');
    expect(resolved.public_description.en).toContain('Mining Cadastre Office');
    expect(resolved.user_outcome).toContain('Mining Cadastre title');
  });

  it('rewrites public_description for AU tenant (state mining authorities)', () => {
    const base = getCapabilityById('mwikila.track.licences');
    const resolved = resolveCapabilityForJurisdiction(base!, 'AU');
    expect(resolved.public_description.en).toContain('Exploration Licence, Mining Lease');
    expect(resolved.public_description.en).toContain('state mining authority');
  });

  it('rewrites alert.licence cadence for NG (annual renewal)', () => {
    const base = getCapabilityById('mwikila.alert.licence');
    const resolved = resolveCapabilityForJurisdiction(base!, 'NG');
    expect(resolved.public_description.en).toContain('365');
    expect(resolved.public_description.en).toContain('Mining Cadastre Office');
  });

  it('rewrites PCCB to EACC for KE compliance filings', () => {
    const base = getCapabilityById('mwikila.compliance.pccb');
    const resolved = resolveCapabilityForJurisdiction(base!, 'KE');
    expect(resolved.public_description.en).toContain('EACC');
    expect(resolved.user_outcome).toContain('EACC');
  });

  it('rewrites PCCB to EFCC + ICPC for NG compliance filings', () => {
    const base = getCapabilityById('mwikila.compliance.pccb');
    const resolved = resolveCapabilityForJurisdiction(base!, 'NG');
    expect(resolved.public_description.en).toContain('EFCC');
    expect(resolved.public_description.en).toContain('ICPC');
  });

  it('returns frozen entries (immutability invariant)', () => {
    const base = getCapabilityById('mwikila.track.licences');
    const resolved = resolveCapabilityForJurisdiction(base!, 'KE');
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('uses default entry when jurisdiction has no override for that capability', () => {
    const base = getCapabilityById('mwikila.compliance.pccb');
    const resolved = resolveCapabilityForJurisdiction(base!, 'UG');
    expect(resolved.user_outcome).toBe(base!.user_outcome);
  });
});
