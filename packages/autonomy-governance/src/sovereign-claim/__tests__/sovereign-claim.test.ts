/**
 * Sovereign-claim verifier tests.
 *
 * Uses a `node:crypto`-backed CryptoPort adapter (tests may touch
 * node:crypto; the leaf under test never does). This proves the pure
 * verifier behaves correctly against a real HMAC implementation.
 */

import { describe, expect, it } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CryptoPort } from '../crypto-port.js';
import {
  SovereignClaimDenied,
  assertSovereignClaim,
  signSovereignClaim,
  tryVerifySovereignClaim,
} from '../sovereign-claim.js';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_SOVEREIGN_ROLE,
  SOVEREIGN_SCOPES,
  type SovereignClaim,
} from '../types.js';

const nodeCrypto: CryptoPort = {
  hmacSha256Hex: (key, message) =>
    createHmac('sha256', key).update(message).digest('hex'),
  timingSafeEqualHex: (aHex, bHex) => {
    let a: Buffer;
    let b: Buffer;
    try {
      a = Buffer.from(aHex, 'hex');
      b = Buffer.from(bHex, 'hex');
    } catch {
      return false;
    }
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  },
};

const KEY = 'test-signing-key-do-not-ship';
const SCOPE = 'reroute_ai_traffic';
const FIXED_NOW = Date.parse('2026-06-03T12:00:00.000Z');

function mint(overrides: Partial<SovereignClaim> = {}): SovereignClaim {
  const base = signSovereignClaim(
    {
      userId: 'user-1',
      role: DEFAULT_SOVEREIGN_ROLE,
      mfaVerifiedAt: new Date(FIXED_NOW - 60_000).toISOString(),
      scope: SCOPE,
    },
    KEY,
    nodeCrypto,
  );
  return { ...base, ...overrides };
}

const baseOpts = {
  signingKey: KEY,
  requiredScope: SCOPE,
  now: () => FIXED_NOW,
} as const;

describe('signSovereignClaim', () => {
  it('produces a deterministic hex signature for a fixed payload', () => {
    const a = signSovereignClaim(
      {
        userId: 'u',
        role: DEFAULT_SOVEREIGN_ROLE,
        mfaVerifiedAt: '2026-06-03T11:59:00.000Z',
        scope: SCOPE,
      },
      KEY,
      nodeCrypto,
    );
    const b = signSovereignClaim(
      {
        userId: 'u',
        role: DEFAULT_SOVEREIGN_ROLE,
        mfaVerifiedAt: '2026-06-03T11:59:00.000Z',
        scope: SCOPE,
      },
      KEY,
      nodeCrypto,
    );
    expect(a.signature).toEqual(b.signature);
    expect(a.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws missing-signing-key when the key is empty', () => {
    expect(() =>
      signSovereignClaim(
        { userId: 'u', role: DEFAULT_SOVEREIGN_ROLE, mfaVerifiedAt: 'x', scope: SCOPE },
        '',
        nodeCrypto,
      ),
    ).toThrow(SovereignClaimDenied);
  });
});

describe('assertSovereignClaim — happy path', () => {
  it('accepts a freshly minted, in-window, correctly scoped claim', () => {
    const claim = mint();
    expect(() => assertSovereignClaim(claim, baseOpts, nodeCrypto)).not.toThrow();
    expect(assertSovereignClaim(claim, baseOpts, nodeCrypto)).toEqual(claim);
  });

  it('accepts every documented sovereign scope', () => {
    for (const scope of SOVEREIGN_SCOPES) {
      const claim = mint({
        scope,
        signature: signSovereignClaim(
          {
            userId: 'user-1',
            role: DEFAULT_SOVEREIGN_ROLE,
            mfaVerifiedAt: new Date(FIXED_NOW - 60_000).toISOString(),
            scope,
          },
          KEY,
          nodeCrypto,
        ).signature,
      });
      expect(() =>
        assertSovereignClaim(claim, { ...baseOpts, requiredScope: scope }, nodeCrypto),
      ).not.toThrow();
    }
  });

  it('is case-insensitive on the role check', () => {
    const claim = signSovereignClaim(
      {
        userId: 'user-1',
        role: 'borjie_super_admin',
        mfaVerifiedAt: new Date(FIXED_NOW - 1000).toISOString(),
        scope: SCOPE,
      },
      KEY,
      nodeCrypto,
    );
    expect(() => assertSovereignClaim(claim, baseOpts, nodeCrypto)).not.toThrow();
  });
});

describe('assertSovereignClaim — rejections', () => {
  it('rejects a null / undefined / non-object claim as malformed', () => {
    for (const bad of [null, undefined, 42, 'str']) {
      expect(() =>
        assertSovereignClaim(bad as unknown as SovereignClaim, baseOpts, nodeCrypto),
      ).toThrowError(/malformed-claim/);
    }
  });

  it('rejects a claim missing a required string field', () => {
    const claim = mint();
    const { signature: _omit, ...partial } = claim;
    expect(() =>
      assertSovereignClaim(partial as unknown as SovereignClaim, baseOpts, nodeCrypto),
    ).toThrowError(/malformed-claim/);
  });

  it('rejects the wrong role before touching crypto', () => {
    const claim = mint({ role: 'TENANT_OWNER' });
    const r = tryVerifySovereignClaim(claim, baseOpts, nodeCrypto);
    expect(r).toEqual({ ok: false, reason: 'wrong-role' });
  });

  it('rejects a claim whose scope does not match the required scope', () => {
    const claim = mint(); // scope=reroute_ai_traffic
    const r = tryVerifySovereignClaim(
      claim,
      { ...baseOpts, requiredScope: 'rotate_secrets' },
      nodeCrypto,
    );
    expect(r).toEqual({ ok: false, reason: 'wrong-scope' });
  });

  it('rejects a tampered signature (scope swap without re-signing)', () => {
    // Mint for one scope, then claim a different scope with the OLD signature.
    const honest = mint();
    const forged: SovereignClaim = { ...honest, scope: 'rotate_secrets' };
    const r = tryVerifySovereignClaim(
      forged,
      { ...baseOpts, requiredScope: 'rotate_secrets' },
      nodeCrypto,
    );
    expect(r).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  it('rejects a signature minted under a different key', () => {
    const claim = signSovereignClaim(
      {
        userId: 'user-1',
        role: DEFAULT_SOVEREIGN_ROLE,
        mfaVerifiedAt: new Date(FIXED_NOW - 1000).toISOString(),
        scope: SCOPE,
      },
      'attacker-key',
      nodeCrypto,
    );
    const r = tryVerifySovereignClaim(claim, baseOpts, nodeCrypto);
    expect(r).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  it('rejects when the verify options carry no signing key', () => {
    const claim = mint();
    const r = tryVerifySovereignClaim(
      claim,
      { ...baseOpts, signingKey: '' },
      nodeCrypto,
    );
    expect(r).toEqual({ ok: false, reason: 'missing-signing-key' });
  });

  it('rejects a stale MFA timestamp (older than the window)', () => {
    const stale = new Date(FIXED_NOW - DEFAULT_MAX_AGE_MS - 1000).toISOString();
    const claim = signSovereignClaim(
      { userId: 'user-1', role: DEFAULT_SOVEREIGN_ROLE, mfaVerifiedAt: stale, scope: SCOPE },
      KEY,
      nodeCrypto,
    );
    const r = tryVerifySovereignClaim(claim, baseOpts, nodeCrypto);
    expect(r).toEqual({ ok: false, reason: 'mfa-expired' });
  });

  it('honours a custom maxAgeMs window', () => {
    const sixMinAgo = new Date(FIXED_NOW - 6 * 60 * 1000).toISOString();
    const claim = signSovereignClaim(
      { userId: 'user-1', role: DEFAULT_SOVEREIGN_ROLE, mfaVerifiedAt: sixMinAgo, scope: SCOPE },
      KEY,
      nodeCrypto,
    );
    // Default 15m window: ok. 5m window: expired.
    expect(tryVerifySovereignClaim(claim, baseOpts, nodeCrypto).ok).toBe(true);
    expect(
      tryVerifySovereignClaim(claim, { ...baseOpts, maxAgeMs: 5 * 60 * 1000 }, nodeCrypto),
    ).toEqual({ ok: false, reason: 'mfa-expired' });
  });

  it('rejects a future-dated MFA beyond the skew tolerance', () => {
    const future = new Date(FIXED_NOW + CLOCK_SKEW_TOLERANCE_MS + 5000).toISOString();
    const claim = signSovereignClaim(
      { userId: 'user-1', role: DEFAULT_SOVEREIGN_ROLE, mfaVerifiedAt: future, scope: SCOPE },
      KEY,
      nodeCrypto,
    );
    const r = tryVerifySovereignClaim(claim, baseOpts, nodeCrypto);
    expect(r).toEqual({ ok: false, reason: 'malformed-claim' });
  });

  it('accepts a slightly future MFA inside the skew tolerance', () => {
    const slightFuture = new Date(FIXED_NOW + 30_000).toISOString();
    const claim = signSovereignClaim(
      { userId: 'user-1', role: DEFAULT_SOVEREIGN_ROLE, mfaVerifiedAt: slightFuture, scope: SCOPE },
      KEY,
      nodeCrypto,
    );
    expect(tryVerifySovereignClaim(claim, baseOpts, nodeCrypto).ok).toBe(true);
  });

  it('rejects an unparseable mfaVerifiedAt as malformed', () => {
    const claim = mint({ mfaVerifiedAt: 'not-a-date' });
    // Re-sign so the signature matches the bad timestamp; failure must be the
    // date parse, not the signature.
    const signed = signSovereignClaim(
      { userId: claim.userId, role: claim.role, mfaVerifiedAt: 'not-a-date', scope: claim.scope },
      KEY,
      nodeCrypto,
    );
    const r = tryVerifySovereignClaim(signed, baseOpts, nodeCrypto);
    expect(r).toEqual({ ok: false, reason: 'malformed-claim' });
  });
});

describe('tryVerifySovereignClaim', () => {
  it('returns ok:true with the verified claim on success', () => {
    const claim = mint();
    const r = tryVerifySovereignClaim(claim, baseOpts, nodeCrypto);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claim).toEqual(claim);
  });
});
