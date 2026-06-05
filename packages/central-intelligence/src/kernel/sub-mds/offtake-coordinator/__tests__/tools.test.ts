import { describe, expect, it } from 'vitest';
import { detectRenewalWindow } from '../tools/detect-renewal-window.js';
import { draftRenewal, type RetentionForecastPort } from '../tools/draft-renewal.js';
import { classifyTerminationRequest } from '../tools/classify-termination-request.js';
import { draftTerminationResponse } from '../tools/draft-termination-response.js';

const DAY = 24 * 60 * 60 * 1000;

describe('detectRenewalWindow', () => {
  it('pre-window when far from expiry', () => {
    const r = detectRenewalWindow({ leaseExpiresAtMs: 90 * DAY, nowMs: 0 });
    expect(r.state).toBe('pre-window');
    expect(r.recommendedAction).toBe('wait');
  });

  it('open when in 60-14 day window', () => {
    const r = detectRenewalWindow({ leaseExpiresAtMs: 60 * DAY, nowMs: 30 * DAY });
    expect(r.state).toBe('open');
    expect(r.recommendedAction).toBe('open-renewal-draft');
  });

  it('closing-soon under 14 days', () => {
    const r = detectRenewalWindow({ leaseExpiresAtMs: 10 * DAY, nowMs: 0 });
    expect(r.state).toBe('closing-soon');
  });

  it('overdue past 7 days after expiry', () => {
    const r = detectRenewalWindow({ leaseExpiresAtMs: 0, nowMs: 10 * DAY });
    expect(r.state).toBe('overdue');
    expect(r.recommendedAction).toBe('mark-overdue');
  });
});

const forecast: RetentionForecastPort = {
  async forecast({ currentRentMinor, proposedRentMinor }) {
    // Simple monotonic decay: more increase = less retention.
    const delta = (proposedRentMinor - currentRentMinor) / currentRentMinor;
    const pRetain = Math.max(0.1, Math.min(0.95, 0.9 - delta * 4));
    return { pRetain, basis: 'fake-curve' };
  },
};

describe('draftRenewal', () => {
  it('produces a draft, never auto-sends', async () => {
    const r = await draftRenewal({
      tenantId: 't1',
      tenantName: 'Asha',
      leaseId: 'l1',
      currentRentMinor: 75000_00,
      currency: 'KES',
      market: { p50Minor: 76000_00, p75Minor: 78000_00, currency: 'KES' },
      forecast,
      language: 'en',
      ownerSignature: 'George',
    });
    expect(r.draftStatus).toBe('queued-for-owner-review');
    expect(r.proposedRentMinor).toBeGreaterThanOrEqual(75000_00);
    expect(r.pRetain).toBeGreaterThan(0);
    expect(r.pRetain).toBeLessThanOrEqual(1);
  });

  it('caps increase at maxIncreasePct', async () => {
    const r = await draftRenewal({
      tenantId: 't1',
      tenantName: 'Asha',
      leaseId: 'l1',
      currentRentMinor: 75000_00,
      currency: 'KES',
      market: { p50Minor: 200000_00, p75Minor: 220000_00, currency: 'KES' }, // way above
      forecast,
      maxIncreasePct: 0.05,
      language: 'en',
      ownerSignature: 'George',
    });
    expect(r.increasePct).toBeLessThanOrEqual(0.05 + 1e-6);
  });

  it('retention verdict reflects forecast', async () => {
    const r = await draftRenewal({
      tenantId: 't1',
      tenantName: 'Asha',
      leaseId: 'l1',
      currentRentMinor: 75000_00,
      currency: 'KES',
      market: { p50Minor: 75000_00, p75Minor: 78000_00, currency: 'KES' },
      forecast,
      language: 'en',
      ownerSignature: 'George',
    });
    expect(['strong', 'fair', 'weak']).toContain(r.retentionVerdict);
  });

  it('renders Swahili when language=sw', async () => {
    const r = await draftRenewal({
      tenantId: 't1',
      tenantName: 'Asha',
      leaseId: 'l1',
      currentRentMinor: 75000_00,
      currency: 'TZS',
      market: { p50Minor: 76000_00, p75Minor: 78000_00, currency: 'TZS' },
      forecast,
      language: 'sw',
      ownerSignature: 'George',
    });
    expect(r.body).toContain('Habari');
  });
});

describe('draftTerminationResponse', () => {
  it('escalates emergency to owner', () => {
    const cls = classifyTerminationRequest('I lost my job, cannot stay');
    const r = draftTerminationResponse({
      classification: cls,
      tenantName: 'Asha',
      leaseId: 'l1',
      minNoticeDays: 30,
      language: 'en',
      ownerSignature: 'George',
    });
    expect(r.suggestedOwnerAction).toBe('escalate-to-owner-urgent');
    expect(r.toneTag).toBe('empathetic-urgent');
  });

  it('investigates dispute', () => {
    const cls = classifyTerminationRequest('Because of the maintenance issues I cannot live here anymore');
    const r = draftTerminationResponse({
      classification: cls, tenantName: 'Asha', leaseId: 'l1', minNoticeDays: 30, language: 'en', ownerSignature: 'George',
    });
    expect(r.suggestedOwnerAction).toBe('investigate-dispute');
  });

  it('exploratory replies with process-clarifying tone', () => {
    const cls = classifyTerminationRequest('What is the process to terminate?');
    const r = draftTerminationResponse({
      classification: cls, tenantName: 'Asha', leaseId: 'l1', minNoticeDays: 30, language: 'en', ownerSignature: 'George',
    });
    expect(r.toneTag).toBe('process-clarifying');
  });

  it('always produces a draft, never auto-sends', () => {
    const cls = classifyTerminationRequest('I am giving notice');
    const r = draftTerminationResponse({
      classification: cls, tenantName: 'Asha', leaseId: 'l1', minNoticeDays: 30, language: 'en', ownerSignature: 'George',
    });
    expect(r.draftStatus).toBe('queued-for-owner-review');
  });
});
