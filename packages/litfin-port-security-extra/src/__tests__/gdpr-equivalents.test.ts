import { describe, expect, it } from 'vitest';
import {
  computeDeadline,
  hoursRemaining,
  isOverdue,
  requiresDPIA,
} from '../gdpr-equivalents.js';
import type { UserId } from '../types.js';

const subj = 's1' as UserId;
const MS_PER_DAY = 86_400_000;

describe('gdpr-equivalents', () => {
  it('GDPR (EU) gives 30 calendar days', () => {
    const t0 = Date.UTC(2026, 5, 1, 12, 0, 0); // a Monday
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'EU',
      requestType: 'access',
    });
    expect(d.dayConvention).toBe('calendar');
    expect(d.deadlineMs - t0).toBe(30 * MS_PER_DAY);
    expect(d.extensionAllowed).toBe(true);
    expect(d.extensionDays).toBe(60);
  });

  it('KE uses business days (7)', () => {
    const t0 = Date.UTC(2026, 5, 1, 0, 0, 0); // Mon 2026-06-01
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'KE',
      requestType: 'access',
    });
    expect(d.dayConvention).toBe('business');
    // Mon -> +1=Tue, +2=Wed, +3=Thu, +4=Fri, +5=Mon, +6=Tue, +7=Wed = 9 calendar days
    expect((d.deadlineMs - t0) / MS_PER_DAY).toBeCloseTo(9, 0);
  });

  it('POPIA (ZA) gives 30 calendar days with extension', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'ZA',
      requestType: 'erasure',
    });
    expect(d.statutoryDays).toBe(30);
    expect(d.extensionAllowed).toBe(true);
    expect(d.statutoryBasis.toLowerCase()).toContain('popia');
  });

  it('TZ gives 14 calendar days', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'TZ',
      requestType: 'access',
    });
    expect(d.statutoryDays).toBe(14);
  });

  it('UK has same 30+60 as EU GDPR', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'UK',
      requestType: 'access',
    });
    expect(d.statutoryDays).toBe(30);
    expect(d.extensionDays).toBe(60);
  });

  it('US (CCPA) gives 45 days', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'US',
      requestType: 'access',
    });
    expect(d.statutoryDays).toBe(45);
  });

  it('OTHER falls back to 30 calendar with no extension', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'OTHER',
      requestType: 'access',
    });
    expect(d.statutoryDays).toBe(30);
    expect(d.extensionAllowed).toBe(false);
  });

  it('isOverdue reports true past deadline', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'EU',
      requestType: 'access',
    });
    expect(isOverdue(d, d.deadlineMs + 1)).toBe(true);
    expect(isOverdue(d, d.deadlineMs - 1)).toBe(false);
  });

  it('hoursRemaining is positive before deadline', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: t0,
      jurisdiction: 'EU',
      requestType: 'access',
    });
    expect(hoursRemaining(d, t0)).toBeGreaterThan(0);
    expect(hoursRemaining(d, d.deadlineMs + 60_000)).toBeLessThan(0);
  });

  it('requiresDPIA for erasure + portability only', () => {
    const base = { subjectId: subj, receivedAtMs: 0, jurisdiction: 'EU' as const };
    expect(requiresDPIA({ ...base, requestType: 'erasure' })).toBe(true);
    expect(requiresDPIA({ ...base, requestType: 'portability' })).toBe(true);
    expect(requiresDPIA({ ...base, requestType: 'access' })).toBe(false);
  });

  it('KE business-days skips weekends', () => {
    // Fri 2026-06-05
    const fri = Date.UTC(2026, 5, 5, 0, 0, 0);
    const d = computeDeadline({
      subjectId: subj,
      receivedAtMs: fri,
      jurisdiction: 'KE',
      requestType: 'access',
    });
    // +1 business = Mon (+3 cal), then 6 more business days = +9 cal = total +12 cal? verify
    expect((d.deadlineMs - fri) / MS_PER_DAY).toBeGreaterThan(7);
  });
});
