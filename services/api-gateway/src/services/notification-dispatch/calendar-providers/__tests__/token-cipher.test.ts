/**
 * CalendarTokenCipher — seal/open round-trip + never-plaintext invariant.
 *
 * Proves the hard rule: a sealed token is NOT the plaintext, is authenticated
 * (tamper → throw), and round-trips. Also proves the env factory refuses to
 * produce a cipher when no key is configured (so the caller can refuse to write
 * plaintext rather than silently degrading).
 */

import { describe, it, expect } from 'vitest';

import {
  createCalendarTokenCipher,
  createCalendarTokenCipherFromEnv,
  isSealedCalendarToken,
  CalendarTokenDecryptError,
} from '../token-cipher';

// A deterministic 32-byte base64 key for tests.
const KEY = Buffer.alloc(32, 7).toString('base64');

describe('CalendarTokenCipher', () => {
  it('round-trips a token and never stores plaintext', () => {
    const cipher = createCalendarTokenCipher(KEY);
    const plaintext = 'ya29.super-secret-refresh-token';

    const sealed = cipher.seal(plaintext);

    // The sealed blob must NOT contain the plaintext anywhere.
    expect(sealed).not.toContain(plaintext);
    expect(sealed.startsWith('v1.gcm.')).toBe(true);
    expect(isSealedCalendarToken(sealed)).toBe(true);

    // And it must decrypt back to exactly the original.
    expect(cipher.open(sealed)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random nonce)', () => {
    const cipher = createCalendarTokenCipher(KEY);
    const a = cipher.seal('same-token');
    const b = cipher.seal('same-token');
    expect(a).not.toBe(b);
    expect(cipher.open(a)).toBe('same-token');
    expect(cipher.open(b)).toBe('same-token');
  });

  it('fails closed (throws) on a tampered blob', () => {
    const cipher = createCalendarTokenCipher(KEY);
    const sealed = cipher.seal('tok');
    // Flip the last ciphertext char.
    const tampered = sealed.slice(0, -1) + (sealed.endsWith('A') ? 'B' : 'A');
    expect(() => cipher.open(tampered)).toThrow(CalendarTokenDecryptError);
  });

  it('rejects a blob sealed under a different key', () => {
    const a = createCalendarTokenCipher(KEY);
    const b = createCalendarTokenCipher(Buffer.alloc(32, 9).toString('base64'));
    const sealed = a.seal('tok');
    expect(() => b.open(sealed)).toThrow(CalendarTokenDecryptError);
  });

  it('accepts a hex key and a passphrase-derived key', () => {
    const hex = createCalendarTokenCipher(Buffer.alloc(32, 3).toString('hex'));
    expect(hex.open(hex.seal('x'))).toBe('x');
    const phrase = createCalendarTokenCipher('a-long-passphrase-that-is-not-32-bytes');
    expect(phrase.open(phrase.seal('y'))).toBe('y');
  });

  it('env factory returns null when no key is configured', () => {
    expect(createCalendarTokenCipherFromEnv({})).toBeNull();
  });

  it('env factory uses CALENDAR_TOKEN_KEY then ENCRYPTION_MASTER_KEY', () => {
    const viaCalKey = createCalendarTokenCipherFromEnv({ CALENDAR_TOKEN_KEY: KEY });
    expect(viaCalKey).not.toBeNull();
    expect(viaCalKey!.open(viaCalKey!.seal('z'))).toBe('z');

    const viaMaster = createCalendarTokenCipherFromEnv({
      ENCRYPTION_MASTER_KEY: KEY,
    });
    expect(viaMaster).not.toBeNull();
  });
});
