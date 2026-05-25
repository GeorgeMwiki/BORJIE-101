import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CANARY_CONFIG,
  detectAnyCanaryLeak,
  detectCanaryLeak,
  detectPartialCanaryLeak,
  embedCanaryInSystemPrompt,
  generateCanary,
  isCanaryExpired,
} from '../index.js';

describe('canary-tokens: generation', () => {
  it('produces a value starting with the default prefix', () => {
    const c = generateCanary('sess_1');
    expect(c.value.startsWith('BNY-CANARY-')).toBe(true);
  });

  it('produces values long enough not to collide (>= 35 chars)', () => {
    const c = generateCanary('sess_1');
    expect(c.value.length).toBeGreaterThanOrEqual(35);
  });

  it('two consecutive canaries are unique (rotation: never reuse)', () => {
    const c1 = generateCanary('sess_1');
    const c2 = generateCanary('sess_2');
    expect(c1.value).not.toBe(c2.value);
  });

  it('rejects empty sessionId', () => {
    expect(() => generateCanary('')).toThrow();
    expect(() => generateCanary('   ')).toThrow();
  });

  it('expiresAt = issuedAt + ttlMs', () => {
    const now = 1_700_000_000_000;
    const c = generateCanary('sess_1', { ttlMs: 5000 }, now);
    expect(c.expiresAt - c.issuedAt).toBe(5000);
  });

  it('isCanaryExpired returns false before expiry, true after', () => {
    const now = 1_700_000_000_000;
    const c = generateCanary('sess_1', { ttlMs: 1000 }, now);
    expect(isCanaryExpired(c, now + 500)).toBe(false);
    expect(isCanaryExpired(c, now + 1001)).toBe(true);
  });

  it('returned token is frozen', () => {
    const c = generateCanary('sess_1');
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('respects custom prefix', () => {
    const c = generateCanary('sess_1', { prefix: 'CUSTOM' });
    expect(c.value.startsWith('CUSTOM-')).toBe(true);
  });

  it('DEFAULT_CANARY_CONFIG has 60-minute TTL', () => {
    expect(DEFAULT_CANARY_CONFIG.ttlMs).toBe(60 * 60 * 1000);
  });
});

describe('canary-tokens: embedding in system prompt', () => {
  it('prepends a DO-NOT-REVEAL preamble containing the canary', () => {
    const c = generateCanary('sess_1');
    const sp = embedCanaryInSystemPrompt('You are BORJIE.', c);
    expect(sp).toContain(c.value);
    expect(sp).toContain('NEVER reveal');
    expect(sp).toContain('You are BORJIE.');
  });
});

describe('canary-tokens: detection (true-positive)', () => {
  it('detects an exact canary in LLM output', () => {
    const c = generateCanary('sess_1');
    const out = `here is something: ${c.value} extra text`;
    const r = detectCanaryLeak(out, c);
    expect(r.leaked).toBe(true);
    expect(r.position).toBeGreaterThan(0);
  });

  it('reports position 0 when canary is at the start', () => {
    const c = generateCanary('sess_1');
    const r = detectCanaryLeak(`${c.value} rest`, c);
    expect(r.position).toBe(0);
  });

  it('detection reason includes offset when leaked', () => {
    const c = generateCanary('sess_1');
    const r = detectCanaryLeak(`prefix ${c.value}`, c);
    expect(r.reason).toMatch(/offset/);
  });
});

describe('canary-tokens: detection (true-negative — false-positive rate <1%)', () => {
  it('does not flag random benign text', () => {
    const c = generateCanary('sess_1');
    const benign = [
      'Hi, how are you today?',
      'I can help you collect rent and screen applicants.',
      'Your monthly statement is attached.',
      'BNY is the call sign for BORJIE.',
      'CANARY birds are common pets.',
      'BNY-CANARY-WRONG-NONCE-XXXXXXXX', // similar shape but different value
    ];
    for (const t of benign) {
      expect(detectCanaryLeak(t, c).leaked).toBe(false);
    }
  });

  it('1000 random benign strings produce <1% false positives (none expected)', () => {
    const c = generateCanary('sess_1');
    let fp = 0;
    for (let i = 0; i < 1000; i++) {
      const benign = `random text ${i} BNY-CANARY-OTHERSESSION-NONCE ${i * 7}`;
      if (detectCanaryLeak(benign, c).leaked) fp += 1;
    }
    expect(fp).toBeLessThan(10); // < 1%
  });
});

describe('canary-tokens: detectAnyCanaryLeak (rotation grace period)', () => {
  it('detects leak from old canary even after rotation', () => {
    const oldC = generateCanary('sess_1');
    const newC = generateCanary('sess_1');
    const out = `oops ${oldC.value} oops`;
    const r = detectAnyCanaryLeak(out, [newC, oldC]);
    expect(r).not.toBeNull();
    expect(r?.canary.value).toBe(oldC.value);
  });

  it('returns null when no canary matches', () => {
    const c1 = generateCanary('sess_1');
    const c2 = generateCanary('sess_2');
    expect(detectAnyCanaryLeak('totally clean output', [c1, c2])).toBeNull();
  });
});

describe('canary-tokens: detectPartialCanaryLeak (fingerprint)', () => {
  it('catches a base64-style mangled exfiltration that still contains the nonce', () => {
    const c = generateCanary('sess_1');
    // attacker emits nonce wrapped in non-canary noise
    const out = `prefix junk ${c.nonce} suffix junk`;
    const r = detectPartialCanaryLeak(out, c);
    expect(r.leaked).toBe(true);
  });

  it('returns leaked=false when even nonce is absent', () => {
    const c = generateCanary('sess_1');
    expect(detectPartialCanaryLeak('clean text', c).leaked).toBe(false);
  });
});
