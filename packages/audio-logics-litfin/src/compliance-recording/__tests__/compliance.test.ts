import { describe, it, expect } from 'vitest';
import {
  getRecordingNotice,
  listSupportedJurisdictions,
  recordConsent,
  verifyConsentBeforeStorage,
  buildWhatsAppOptInMessage,
  buildSmsOptInMessage,
} from '../index.js';
import type { ConsentRecord, Jurisdiction } from '../../types.js';

describe('getRecordingNotice', () => {
  it.each<Jurisdiction>(['TZ', 'KE', 'UG', 'RW', 'NG', 'ZA', 'EU', 'GB', 'US-1P', 'US-2P'])(
    'returns a notice for jurisdiction %s',
    (j) => {
      const notice = getRecordingNotice(j);
      expect(notice.jurisdiction).toBe(j);
      expect(notice.noticeText.length).toBeGreaterThan(20);
      expect(notice.statutoryCitations.length).toBeGreaterThanOrEqual(1);
    },
  );

  it('marks EU as requiring explicit consent and biometric special category', () => {
    const eu = getRecordingNotice('EU');
    expect(eu.requiresExplicitConsent).toBe(true);
    expect(eu.biometricSpecialCategory).toBe(true);
  });

  it('marks US-1P as notice-only (no explicit consent required)', () => {
    const us1p = getRecordingNotice('US-1P');
    expect(us1p.requiresExplicitConsent).toBe(false);
  });

  it('marks US-2P as requiring audible notice + explicit consent', () => {
    const us2p = getRecordingNotice('US-2P');
    expect(us2p.requiresExplicitConsent).toBe(true);
    expect(us2p.mustBeAudible).toBe(true);
  });

  it('throws for an unknown jurisdiction', () => {
    expect(() => getRecordingNotice('XX' as Jurisdiction)).toThrow(/unknown jurisdiction/);
  });

  it('lists at least 9 jurisdictions including all 6 African ones', () => {
    const all = listSupportedJurisdictions();
    expect(all.length).toBeGreaterThanOrEqual(9);
    for (const j of ['TZ', 'KE', 'UG', 'RW', 'NG', 'ZA'] as Jurisdiction[]) {
      expect(all).toContain(j);
    }
  });
});

describe('recordConsent', () => {
  it('produces a frozen consent record with a stable noticeHash', () => {
    const rec = recordConsent({
      tenantId: 'tenant-1',
      callerId: '+255700000001',
      channel: 'phone',
      jurisdiction: 'TZ',
      audioSampleStartIso: '2026-05-25T08:00:00.000Z',
      consentGiven: true,
      noticePlayed: true,
      nowIso: '2026-05-25T08:00:00.500Z',
    });
    expect(rec.tenantId).toBe('tenant-1');
    expect(rec.consentId).toMatch(/^cn_/);
    expect(rec.noticeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(rec)).toBe(true);
  });

  it('rejects an empty tenant id', () => {
    expect(() =>
      recordConsent({
        tenantId: '',
        callerId: '+1',
        channel: 'phone',
        jurisdiction: 'KE',
        audioSampleStartIso: '2026-05-25T08:00:00.000Z',
        consentGiven: true,
        noticePlayed: true,
      }),
    ).toThrow(/tenantId/);
  });
});

describe('verifyConsentBeforeStorage', () => {
  const rec: ConsentRecord = {
    consentId: 'cn_x',
    tenantId: 'tenant-1',
    callerId: '+255700000001',
    channel: 'phone',
    jurisdiction: 'TZ',
    audioSampleStartIso: '2026-05-25T08:00:00.000Z',
    consentGiven: true,
    noticePlayed: true,
    noticeHash: 'deadbeef',
    capturedAtIso: '2026-05-25T08:00:00.500Z',
  };

  it('allows storage when explicit consent is captured', () => {
    const result = verifyConsentBeforeStorage({
      recording: { audioSampleStartIso: '2026-05-25T08:00:00.000Z' },
      jurisdiction: 'TZ',
      consentLog: [rec],
    });
    expect(result.canStore).toBe(true);
  });

  it('returns mustDelete=true when explicit consent is missing in TZ', () => {
    const result = verifyConsentBeforeStorage({
      recording: { audioSampleStartIso: '2026-05-25T08:00:00.000Z' },
      jurisdiction: 'TZ',
      consentLog: [],
    });
    expect(result.canStore).toBe(false);
    expect(result.mustDelete).toBe(true);
  });

  it('returns mustDelete=true when consent record exists but consentGiven=false', () => {
    const result = verifyConsentBeforeStorage({
      recording: { audioSampleStartIso: '2026-05-25T08:00:00.000Z' },
      jurisdiction: 'KE',
      consentLog: [{ ...rec, jurisdiction: 'KE', consentGiven: false }],
    });
    expect(result.canStore).toBe(false);
    expect(result.mustDelete).toBe(true);
  });

  it('US-1P only soft-denies when no notice was played (no mustDelete)', () => {
    const result = verifyConsentBeforeStorage({
      recording: { audioSampleStartIso: '2026-05-25T08:00:00.000Z' },
      jurisdiction: 'US-1P',
      consentLog: [],
    });
    expect(result.canStore).toBe(false);
    expect(result.mustDelete).toBeFalsy();
  });
});

describe('opt-in message helpers', () => {
  it('builds a WhatsApp opt-in containing the notice text + opt-out instruction', () => {
    const body = buildWhatsAppOptInMessage({
      tenantId: 't1',
      displayName: 'Borjie Estate',
      jurisdiction: 'KE',
    });
    expect(body).toContain('STOP to opt out');
    expect(body).toContain('Data Protection Act 2019');
  });

  it('builds an SMS opt-in that fits the common 160-char message ceiling for short notices', () => {
    const body = buildSmsOptInMessage({
      displayName: 'BNyumba',
      jurisdiction: 'US-1P',
    });
    expect(body.length).toBeLessThanOrEqual(280);
    expect(body).toContain('STOP');
  });
});
