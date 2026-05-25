import { describe, expect, it } from 'vitest';
import {
  detectFromJWTClaim,
  parseJWTPayloadUnsafe,
} from '../detect/detect-from-jwt-claim.js';

describe('detectFromJWTClaim', () => {
  it('extracts the zoneinfo claim verbatim', () => {
    const r = detectFromJWTClaim({ zoneinfo: 'Africa/Nairobi' });
    expect(r?.timezone).toBe('Africa/Nairobi');
    expect(r?.source).toBe('jwt-claim');
    expect(r?.confidence).toBe(1.0);
  });

  it('returns null when the claim is missing', () => {
    expect(detectFromJWTClaim({})).toBeNull();
  });

  it('returns null when the claim is not a string', () => {
    expect(detectFromJWTClaim({ zoneinfo: 42 as unknown as string })).toBeNull();
  });

  it('returns null when the claim is an invalid TZ', () => {
    expect(detectFromJWTClaim({ zoneinfo: 'Mars/Olympus' })).toBeNull();
  });

  it('returns null on null / undefined payload', () => {
    expect(detectFromJWTClaim(null)).toBeNull();
    expect(detectFromJWTClaim(undefined)).toBeNull();
  });
});

describe('parseJWTPayloadUnsafe', () => {
  it('extracts a payload from a well-formed token', () => {
    const payload = { sub: 'u1', zoneinfo: 'Africa/Kampala' };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const token = `header.${b64}.signature`;
    const r = parseJWTPayloadUnsafe(token);
    expect(r?.zoneinfo).toBe('Africa/Kampala');
  });

  it('returns null on non-string input', () => {
    expect(parseJWTPayloadUnsafe(undefined as unknown as string)).toBeNull();
  });

  it('returns null on a token that is not 3 segments', () => {
    expect(parseJWTPayloadUnsafe('a.b')).toBeNull();
  });

  it('returns null on a payload that is not JSON', () => {
    expect(parseJWTPayloadUnsafe('a.notb64.c')).toBeNull();
  });
});
