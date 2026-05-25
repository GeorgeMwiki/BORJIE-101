/**
 * Tests for the secrets-derivation rotation helper.
 *
 * Covers:
 *   - sign / verify round-trip
 *   - tampered signature rejection
 *   - dual-key verify (current AND previous accepted during overlap)
 *   - returns the role of the matching key
 *   - constant-time check is still executed when previous is absent
 *   - resolveSecretPair env contract (rotating flag, missing var error)
 *   - verifyWithEnvRotation end-to-end
 */

import { describe, it, expect } from 'vitest';
import {
  sign,
  verify,
  verifyWithRotation,
  resolveSecretPair,
  verifyWithEnvRotation,
} from '../secrets-derivation.js';

const CURRENT = 'current-root-key-with-enough-entropy-1234567890';
const PREVIOUS = 'previous-root-key-still-trusted-during-soak-0987654321';
const MESSAGE = 'tenant=acme|action=charge|amount=4200|ts=1715000000';

describe('secrets-derivation / sign + verify', () => {
  it('sign produces a stable lowercase hex digest', () => {
    const sig = sign(CURRENT, MESSAGE);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // deterministic across calls
    expect(sign(CURRENT, MESSAGE)).toBe(sig);
  });

  it('verify accepts a matching signature', () => {
    const sig = sign(CURRENT, MESSAGE);
    expect(verify(CURRENT, MESSAGE, sig)).toBe(true);
  });

  it('verify rejects a tampered signature', () => {
    const sig = sign(CURRENT, MESSAGE);
    const tampered = sig.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    expect(verify(CURRENT, MESSAGE, tampered)).toBe(false);
  });

  it('verify rejects when value is altered', () => {
    const sig = sign(CURRENT, MESSAGE);
    expect(verify(CURRENT, MESSAGE + 'x', sig)).toBe(false);
  });

  it('sign throws on empty secret', () => {
    expect(() => sign('', MESSAGE)).toThrow(/non-empty/);
  });

  it('verify returns false on empty secret without throwing', () => {
    expect(verify('', MESSAGE, 'a'.repeat(64))).toBe(false);
  });

  it('supports sha384 / sha512 algorithms', () => {
    const s384 = sign(CURRENT, MESSAGE, 'sha384');
    const s512 = sign(CURRENT, MESSAGE, 'sha512');
    expect(s384).toMatch(/^[0-9a-f]{96}$/);
    expect(s512).toMatch(/^[0-9a-f]{128}$/);
    expect(verify(CURRENT, MESSAGE, s384, 'sha384')).toBe(true);
    expect(verify(CURRENT, MESSAGE, s512, 'sha512')).toBe(true);
    // mismatched algorithm fails
    expect(verify(CURRENT, MESSAGE, s384, 'sha256')).toBe(false);
  });
});

describe('secrets-derivation / verifyWithRotation', () => {
  it('returns "current" when signature was made with the current key', () => {
    const sig = sign(CURRENT, MESSAGE);
    expect(verifyWithRotation(CURRENT, PREVIOUS, MESSAGE, sig)).toBe('current');
  });

  it('returns "previous" when signature was made with the previous key', () => {
    const sig = sign(PREVIOUS, MESSAGE);
    expect(verifyWithRotation(CURRENT, PREVIOUS, MESSAGE, sig)).toBe(
      'previous',
    );
  });

  it('returns null when neither key matches', () => {
    const sig = sign('other-key', MESSAGE);
    expect(verifyWithRotation(CURRENT, PREVIOUS, MESSAGE, sig)).toBeNull();
  });

  it('accepts null prevSecret (post-retire state)', () => {
    const sig = sign(CURRENT, MESSAGE);
    expect(verifyWithRotation(CURRENT, null, MESSAGE, sig)).toBe('current');
  });

  it('accepts undefined prevSecret', () => {
    const sig = sign(CURRENT, MESSAGE);
    expect(verifyWithRotation(CURRENT, undefined, MESSAGE, sig)).toBe(
      'current',
    );
  });

  it('rejects a previous-key signature once previous is removed (retired)', () => {
    const sig = sign(PREVIOUS, MESSAGE);
    expect(verifyWithRotation(CURRENT, null, MESSAGE, sig)).toBeNull();
  });

  it('rejects when current secret is empty', () => {
    const sig = sign(PREVIOUS, MESSAGE);
    expect(verifyWithRotation('', PREVIOUS, MESSAGE, sig)).toBeNull();
  });

  it('rejects an empty signature', () => {
    expect(verifyWithRotation(CURRENT, PREVIOUS, MESSAGE, '')).toBeNull();
  });

  it('treats empty prevSecret as no previous key', () => {
    const sig = sign(PREVIOUS, MESSAGE);
    expect(verifyWithRotation(CURRENT, '', MESSAGE, sig)).toBeNull();
  });

  it('does not return "previous" for a signature that also matches current (preference order)', () => {
    // Edge case: when current === previous (operator misconfig), we
    // prefer the "current" answer so callers don't get false
    // rotation signals.
    const sig = sign(CURRENT, MESSAGE);
    expect(verifyWithRotation(CURRENT, CURRENT, MESSAGE, sig)).toBe('current');
  });
});

describe('secrets-derivation / resolveSecretPair', () => {
  it('returns { current, previous: null, rotating: false } when only current is set', () => {
    const pair = resolveSecretPair('FOO', {
      FOO: 'value-A',
    } as NodeJS.ProcessEnv);
    expect(pair).toEqual({
      current: 'value-A',
      previous: null,
      rotating: false,
    });
  });

  it('returns rotating: true when FOO_PREV is set', () => {
    const pair = resolveSecretPair('FOO', {
      FOO: 'value-A',
      FOO_PREV: 'value-A-old',
    } as NodeJS.ProcessEnv);
    expect(pair.current).toBe('value-A');
    expect(pair.previous).toBe('value-A-old');
    expect(pair.rotating).toBe(true);
  });

  it('treats empty FOO_PREV as not rotating', () => {
    const pair = resolveSecretPair('FOO', {
      FOO: 'value-A',
      FOO_PREV: '',
    } as NodeJS.ProcessEnv);
    expect(pair.rotating).toBe(false);
    expect(pair.previous).toBeNull();
  });

  it('throws when FOO is missing', () => {
    expect(() =>
      resolveSecretPair('FOO', {} as NodeJS.ProcessEnv),
    ).toThrow(/FOO is required/);
  });

  it('throws when FOO is empty', () => {
    expect(() =>
      resolveSecretPair('FOO', { FOO: '' } as NodeJS.ProcessEnv),
    ).toThrow(/FOO is required/);
  });

  it('returned pair is frozen (immutable)', () => {
    const pair = resolveSecretPair('FOO', {
      FOO: 'value-A',
    } as NodeJS.ProcessEnv);
    expect(Object.isFrozen(pair)).toBe(true);
  });
});

describe('secrets-derivation / verifyWithEnvRotation', () => {
  it('verifies via env-resolved rotation pair', () => {
    const env = {
      AUDIT_HMAC_KEY: CURRENT,
      AUDIT_HMAC_KEY_PREV: PREVIOUS,
    } as NodeJS.ProcessEnv;
    const sigOld = sign(PREVIOUS, MESSAGE);
    const sigNew = sign(CURRENT, MESSAGE);
    expect(
      verifyWithEnvRotation('AUDIT_HMAC_KEY', MESSAGE, sigNew, { env }),
    ).toBe('current');
    expect(
      verifyWithEnvRotation('AUDIT_HMAC_KEY', MESSAGE, sigOld, { env }),
    ).toBe('previous');
  });

  it('honours algorithm option', () => {
    const env = { AUDIT_HMAC_KEY: CURRENT } as NodeJS.ProcessEnv;
    const sig = sign(CURRENT, MESSAGE, 'sha512');
    expect(
      verifyWithEnvRotation('AUDIT_HMAC_KEY', MESSAGE, sig, {
        env,
        algorithm: 'sha512',
      }),
    ).toBe('current');
  });
});
