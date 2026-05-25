import { beforeEach, describe, expect, it } from 'vitest';
import {
  ageOfDataConsent,
  createConsentService,
  needsParentalConsent,
  type ConsentService,
} from '../consent/index.js';
import { createInMemoryStore } from '../in-memory-store.js';

describe('age-of-consent — per-jurisdiction', () => {
  it('returns 13 for US (COPPA federal floor)', () => {
    expect(ageOfDataConsent('US')).toBe(13);
  });
  it('returns 16 for EU (GDPR Art 8)', () => {
    expect(ageOfDataConsent('EU')).toBe(16);
  });
  it('returns 13 for UK (under WCAG/AADC interpretation)', () => {
    expect(ageOfDataConsent('UK')).toBe(13);
  });
  it('returns 18 for ZA, TZ, KE, UG, RW, NG', () => {
    expect(ageOfDataConsent('ZA')).toBe(18);
    expect(ageOfDataConsent('TZ')).toBe(18);
    expect(ageOfDataConsent('KE')).toBe(18);
    expect(ageOfDataConsent('UG')).toBe(18);
    expect(ageOfDataConsent('RW')).toBe(18);
    expect(ageOfDataConsent('NG')).toBe(18);
  });
  it('needsParentalConsent matches the table', () => {
    expect(needsParentalConsent(12, 'US')).toBe(true);
    expect(needsParentalConsent(13, 'US')).toBe(false);
    expect(needsParentalConsent(15, 'EU')).toBe(true);
    expect(needsParentalConsent(16, 'EU')).toBe(false);
    expect(needsParentalConsent(17, 'TZ')).toBe(true);
    expect(needsParentalConsent(18, 'TZ')).toBe(false);
  });
});

describe('ConsentService — round-trip + verify', () => {
  let service: ConsentService;

  beforeEach(() => {
    service = createConsentService({ store: createInMemoryStore() });
  });

  it('records consent + verify returns granted=true', async () => {
    const r = await service.recordConsent({
      subjectId: 'sub-1',
      scope: 'data-processing',
      version: 'v1',
      channel: 'web',
      jurisdiction: 'TZ',
    });
    expect(r.granted).toBe(true);
    const status = await service.verifyConsent({
      subjectId: 'sub-1',
      scope: 'data-processing',
      currentVersion: 'v1',
    });
    expect(status.granted).toBe(true);
    expect(status.needsRefresh).toBe(false);
  });

  it('verify returns no-consent for new subject', async () => {
    const status = await service.verifyConsent({
      subjectId: 'unknown',
      scope: 'data-processing',
      currentVersion: 'v1',
    });
    expect(status.granted).toBe(false);
    expect(status.reason).toBe('no-consent-recorded');
  });

  it('verify returns version-bumped when current > recorded', async () => {
    await service.recordConsent({
      subjectId: 'sub-2',
      scope: 'marketing',
      version: 'v1',
      channel: 'web',
      jurisdiction: 'EU',
    });
    const status = await service.verifyConsent({
      subjectId: 'sub-2',
      scope: 'marketing',
      currentVersion: 'v2',
    });
    expect(status.granted).toBe(false);
    expect(status.reason).toBe('version-bumped');
  });

  it('verify flags jurisdiction-changed when subject moves', async () => {
    await service.recordConsent({
      subjectId: 'sub-3',
      scope: 'analytics',
      version: 'v1',
      channel: 'web',
      jurisdiction: 'KE',
    });
    const status = await service.verifyConsent({
      subjectId: 'sub-3',
      scope: 'analytics',
      currentVersion: 'v1',
      currentJurisdiction: 'EU',
    });
    expect(status.granted).toBe(false);
    expect(status.reason).toBe('jurisdiction-changed');
  });

  it('withdrawConsent appends granted=false and verify reflects it', async () => {
    await service.recordConsent({
      subjectId: 'sub-4',
      scope: 'sms',
      version: 'v1',
      channel: 'sms',
      jurisdiction: 'TZ',
    });
    await service.withdrawConsent({
      subjectId: 'sub-4',
      scope: 'sms',
      version: 'v1',
      channel: 'sms',
      jurisdiction: 'TZ',
      reason: 'no-longer-interested',
    });
    const status = await service.verifyConsent({
      subjectId: 'sub-4',
      scope: 'sms',
      currentVersion: 'v1',
    });
    expect(status.granted).toBe(false);
    expect(status.reason).toBe('consent-withdrawn');
  });

  it('history returns full append-only chain', async () => {
    await service.recordConsent({
      subjectId: 'sub-5',
      scope: 'cookies',
      version: 'v1',
      channel: 'web',
      jurisdiction: 'EU',
    });
    await service.withdrawConsent({
      subjectId: 'sub-5',
      scope: 'cookies',
      version: 'v1',
      channel: 'web',
      jurisdiction: 'EU',
      reason: 'changed-mind',
    });
    await service.recordConsent({
      subjectId: 'sub-5',
      scope: 'cookies',
      version: 'v2',
      channel: 'web',
      jurisdiction: 'EU',
    });
    const hist = await service.history({ subjectId: 'sub-5', scope: 'cookies' });
    expect(hist.length).toBe(3);
    expect(hist[0]?.granted).toBe(true);
    expect(hist[1]?.granted).toBe(false);
    expect(hist[2]?.version).toBe('v2');
  });
});

describe('ConsentService — parental consent per jurisdiction', () => {
  let service: ConsentService;

  beforeEach(() => {
    service = createConsentService({ store: createInMemoryStore() });
  });

  const verifyParentTrue = (): boolean => true;
  const verifyParentFalse = (): boolean => false;

  it('TZ (age 18) — parent grants for 12-year-old', async () => {
    const r = await service.parentalConsent({
      minorSubjectId: 'minor-tz',
      parentSubjectId: 'parent-tz',
      parentAge: 35,
      scope: 'children-data',
      version: 'v1',
      channel: 'in-person',
      jurisdiction: 'TZ',
      verifyParent: verifyParentTrue,
    });
    expect(r.grantedBy).toBe('parent-tz');
    expect(r.granted).toBe(true);
  });

  it('KE (age 18) — parent grants for 17-year-old', async () => {
    const r = await service.parentalConsent({
      minorSubjectId: 'minor-ke',
      parentSubjectId: 'parent-ke',
      parentAge: 40,
      scope: 'children-data',
      version: 'v1',
      channel: 'in-person',
      jurisdiction: 'KE',
      verifyParent: verifyParentTrue,
    });
    expect(r.granted).toBe(true);
  });

  it('EU (age 16) — parent grants for 13-year-old', async () => {
    const r = await service.parentalConsent({
      minorSubjectId: 'minor-eu',
      parentSubjectId: 'parent-eu',
      parentAge: 30,
      scope: 'children-data',
      version: 'v1',
      channel: 'web',
      jurisdiction: 'EU',
      verifyParent: verifyParentTrue,
    });
    expect(r.granted).toBe(true);
  });

  it('US (COPPA age 13) — parent grants for 8-year-old', async () => {
    const r = await service.parentalConsent({
      minorSubjectId: 'minor-us',
      parentSubjectId: 'parent-us',
      parentAge: 28,
      scope: 'children-data',
      version: 'v1',
      channel: 'web',
      jurisdiction: 'US',
      verifyParent: verifyParentTrue,
    });
    expect(r.granted).toBe(true);
  });

  it('throws if parent verification fails', async () => {
    await expect(
      service.parentalConsent({
        minorSubjectId: 'm',
        parentSubjectId: 'p',
        parentAge: 35,
        scope: 'children-data',
        version: 'v1',
        channel: 'web',
        jurisdiction: 'US',
        verifyParent: verifyParentFalse,
      }),
    ).rejects.toThrow('parent verification failed');
  });

  it('throws if parent is below age of consent themselves', async () => {
    await expect(
      service.parentalConsent({
        minorSubjectId: 'm',
        parentSubjectId: 'p',
        parentAge: 14,
        scope: 'children-data',
        version: 'v1',
        channel: 'web',
        jurisdiction: 'TZ',
        verifyParent: verifyParentTrue,
      }),
    ).rejects.toThrow('below age of data consent');
  });
});
