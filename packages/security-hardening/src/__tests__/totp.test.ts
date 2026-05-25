import { describe, it, expect } from 'vitest';

import {
  toBase32,
  fromBase32,
  totp,
  buildOtpAuthUri,
  createTOTPService,
} from '../mfa/totp.js';

describe('base32 round trip', () => {
  it('encodes + decodes back to the original bytes', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x12, 0x34, 0x56]);
    const b32 = toBase32(original);
    const back = fromBase32(b32);
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('decoding rejects characters outside the base32 alphabet', () => {
    expect(() => fromBase32('AAAA!')).toThrow();
  });
});

describe('RFC 6238 TOTP — known vectors', () => {
  // Test secret from RFC 6238 appendix B: ASCII "12345678901234567890"
  const secret = new TextEncoder().encode('12345678901234567890');

  it.each([
    [59 * 1000, '94287082'],
    [1_111_111_109 * 1000, '07081804'],
    [1_111_111_111 * 1000, '14050471'],
    [1_234_567_890 * 1000, '89005924'],
  ])('SHA1 8-digit @ epoch %i -> %s', (atMs, expected) => {
    const code = totp(secret, atMs, { digits: 8, algorithm: 'SHA1' });
    expect(code).toBe(expected);
  });
});

describe('otpauth:// URI builder', () => {
  it('encodes the issuer + account name and includes the secret', () => {
    const uri = buildOtpAuthUri({
      issuer: 'BORJIE',
      accountName: 'george@example.com',
      secretBase32: 'JBSWY3DPEHPK3PXP',
    });
    expect(uri.startsWith('otpauth://totp/BORJIE:')).toBe(true);
    expect(uri).toContain('george%40example.com');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=BORJIE');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(uri).toContain('algorithm=SHA1');
  });
});

describe('TOTP service', () => {
  function buildSvc(now = 60_000, rngByte = 0x55) {
    return createTOTPService({
      issuer: 'BORJIE',
      now: () => now,
      randomBytes: (n) => {
        const out = new Uint8Array(n);
        for (let i = 0; i < n; i++) out[i] = rngByte;
        return out;
      },
    });
  }

  it('generates a 160-bit base32 secret + a scannable otpauth URI', () => {
    const svc = buildSvc();
    const sec = svc.generateSecret({ accountName: 'georgemwikila@gmail.com' });
    // 20 bytes -> ceil(20*8/5) = 32 base32 chars
    expect(sec.base32.length).toBe(32);
    expect(sec.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(sec.otpauthUri).toContain(sec.base32);
  });

  it('a freshly-generated code verifies immediately', () => {
    const svc = buildSvc();
    const sec = svc.generateSecret({ accountName: 'a' });
    const code = svc.generate(sec.base32);
    const result = svc.verify(sec.base32, code);
    expect(result.ok).toBe(true);
    expect(result.delta).toBe(0);
  });

  it('accepts the code from the previous 30s window (clock skew)', () => {
    const t0 = 60_000;
    const svc = createTOTPService({
      issuer: 'X',
      now: () => t0,
      windowSteps: 1,
    });
    const sec = svc.generateSecret({ accountName: 'a' });
    const earlyCode = svc.generate(sec.base32, t0 - 30_000);
    const result = svc.verify(sec.base32, earlyCode);
    expect(result.ok).toBe(true);
    expect(result.delta).toBe(-1);
  });

  it('REJECTS codes outside the skew window', () => {
    const t0 = 600_000;
    const svc = createTOTPService({
      issuer: 'X',
      now: () => t0,
      windowSteps: 1,
    });
    const sec = svc.generateSecret({ accountName: 'a' });
    const tooOldCode = svc.generate(sec.base32, t0 - 5 * 30_000);
    const result = svc.verify(sec.base32, tooOldCode);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_match');
  });

  it('REJECTS codes of the wrong length', () => {
    const svc = buildSvc();
    const sec = svc.generateSecret({ accountName: 'a' });
    expect(svc.verify(sec.base32, '12345').ok).toBe(false);
    expect(svc.verify(sec.base32, '1234567').ok).toBe(false);
  });
});
