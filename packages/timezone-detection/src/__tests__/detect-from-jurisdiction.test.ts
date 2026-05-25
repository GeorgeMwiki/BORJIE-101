import { describe, expect, it } from 'vitest';
import { detectFromJurisdiction } from '../detect/detect-from-jurisdiction.js';

describe('detectFromJurisdiction — 6 East African defaults (TZ/KE/UG/RW/NG/ZA)', () => {
  it('TZ → Africa/Dar_es_Salaam', () => {
    expect(detectFromJurisdiction('TZ')?.timezone).toBe('Africa/Dar_es_Salaam');
  });

  it('KE → Africa/Nairobi', () => {
    expect(detectFromJurisdiction('KE')?.timezone).toBe('Africa/Nairobi');
  });

  it('UG → Africa/Kampala', () => {
    expect(detectFromJurisdiction('UG')?.timezone).toBe('Africa/Kampala');
  });

  it('RW → Africa/Kigali', () => {
    expect(detectFromJurisdiction('RW')?.timezone).toBe('Africa/Kigali');
  });

  it('NG → Africa/Lagos', () => {
    expect(detectFromJurisdiction('NG')?.timezone).toBe('Africa/Lagos');
  });

  it('ZA → Africa/Johannesburg', () => {
    expect(detectFromJurisdiction('ZA')?.timezone).toBe('Africa/Johannesburg');
  });
});

describe('detectFromJurisdiction — Western-world spot checks', () => {
  it('GB → Europe/London (DST observed)', () => {
    const r = detectFromJurisdiction('GB');
    expect(r?.timezone).toBe('Europe/London');
  });

  it('US → America/New_York (multi-zone, capital fallback)', () => {
    const r = detectFromJurisdiction('US');
    expect(r?.timezone).toBe('America/New_York');
    // Multi-zone — confidence is lower so apps prefer browser/IP.
    expect(r?.confidence).toBeLessThan(0.3);
  });

  it('DE → Europe/Berlin', () => {
    expect(detectFromJurisdiction('DE')?.timezone).toBe('Europe/Berlin');
  });

  it('JP → Asia/Tokyo', () => {
    expect(detectFromJurisdiction('JP')?.timezone).toBe('Asia/Tokyo');
  });
});

describe('detectFromJurisdiction — case-insensitive + nullish handling', () => {
  it('lower-case code resolves', () => {
    expect(detectFromJurisdiction('tz')?.timezone).toBe('Africa/Dar_es_Salaam');
  });

  it('null / empty / undefined → null', () => {
    expect(detectFromJurisdiction(null)).toBeNull();
    expect(detectFromJurisdiction('')).toBeNull();
    expect(detectFromJurisdiction(undefined)).toBeNull();
  });

  it('unknown code → null (resolver falls through to UTC)', () => {
    expect(detectFromJurisdiction('XX')).toBeNull();
  });
});
