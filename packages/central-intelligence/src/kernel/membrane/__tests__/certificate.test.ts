/**
 * R7 — SafetyCertificate builder tests.
 *
 * Proves the keystone properties: REFUSE-BY-DEFAULT (missing/unsatisfied
 * required invariant → 'refuse'), all-required-satisfied → 'allow', the
 * hash chains off `prevHash`, and any single required-invariant violation
 * flips the verdict.
 */

import { describe, it, expect } from 'vitest';
import { verifyChain, GENESIS_HASH } from '@borjie/audit-hash-chain';
import {
  buildCertificate,
  computeVerdict,
  SafetyCertificateSchema,
  SAFETY_INVARIANT_NAMES,
  type InvariantResult,
} from '../certificate.js';

function req(name: InvariantResult['name'], satisfied: boolean): InvariantResult {
  return { name, satisfied, required: true, evidence: `${name}=${satisfied}` };
}

function allSatisfied(): InvariantResult[] {
  return SAFETY_INVARIANT_NAMES.map((n) => req(n, true));
}

describe('computeVerdict — refuse-by-default', () => {
  it('returns refuse when the required set is empty (nothing proven)', () => {
    expect(computeVerdict([])).toBe('refuse');
    expect(
      computeVerdict([
        { name: 'k-anon-held', satisfied: true, required: false, evidence: 'n/a' },
      ]),
    ).toBe('refuse');
  });

  it('returns allow only when every required invariant is satisfied', () => {
    expect(computeVerdict(allSatisfied())).toBe('allow');
  });

  it('flips to refuse if ANY single required invariant is unsatisfied', () => {
    for (const target of SAFETY_INVARIANT_NAMES) {
      const checks = SAFETY_INVARIANT_NAMES.map((n) => req(n, n !== target));
      expect(computeVerdict(checks)).toBe('refuse');
    }
  });

  it('ignores an unsatisfied NON-required invariant', () => {
    const checks: InvariantResult[] = [
      req('policy-gate-allowed', true),
      { name: 'k-anon-held', satisfied: false, required: false, evidence: 'n/a' },
    ];
    expect(computeVerdict(checks)).toBe('allow');
  });
});

describe('buildCertificate — shape + verdict', () => {
  it('produces a schema-valid, allow certificate when all required pass', () => {
    const cert = buildCertificate(
      {
        certId: 'cert_1',
        actionRef: 'thought_abc',
        tenantScope: 'tenant_x',
        checks: allSatisfied(),
        issuedAtMs: 1000,
      },
      GENESIS_HASH,
    );
    expect(cert.verdict).toBe('allow');
    expect(() => SafetyCertificateSchema.parse(cert)).not.toThrow();
  });

  it('refuses when a required invariant is unsatisfied', () => {
    const checks = SAFETY_INVARIANT_NAMES.map((n) =>
      req(n, n !== 'egress-clean'),
    );
    const cert = buildCertificate(
      {
        certId: 'cert_2',
        actionRef: 'thought_def',
        tenantScope: 'platform',
        checks,
        issuedAtMs: 2000,
      },
      GENESIS_HASH,
    );
    expect(cert.verdict).toBe('refuse');
  });
});

describe('buildCertificate — hash chaining', () => {
  it('uses GENESIS_HASH as priorHash when an empty prevHash is supplied', () => {
    const cert = buildCertificate(
      {
        certId: 'c',
        actionRef: 'a',
        tenantScope: 't',
        checks: allSatisfied(),
        issuedAtMs: 1,
      },
      '',
    );
    expect(cert.priorHash).toBe(GENESIS_HASH);
    expect(cert.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains the second certificate off the first, verifiable by verifyChain', () => {
    const c1 = buildCertificate(
      {
        certId: 'c1',
        actionRef: 'a1',
        tenantScope: 't',
        checks: allSatisfied(),
        issuedAtMs: 1,
      },
      GENESIS_HASH,
    );
    const c2 = buildCertificate(
      {
        certId: 'c2',
        actionRef: 'a2',
        tenantScope: 't',
        checks: allSatisfied(),
        issuedAtMs: 2,
      },
      c1.hash,
    );
    expect(c2.priorHash).toBe(c1.hash);
    expect(c2.hash).not.toBe(c1.hash);

    // Rebuild the canonical chain-entry shape and verify it end-to-end.
    const entries = [c1, c2].map((c, i) => ({
      index: i,
      prevHash: c.priorHash,
      rowHash: c.hash,
      payload: {
        certId: c.certId,
        actionRef: c.actionRef,
        tenantScope: c.tenantScope,
        invariantResults: c.invariantResults,
        verdict: c.verdict,
        issuedAtMs: c.issuedAtMs,
      },
      sealedAtIso: new Date(c.issuedAtMs).toISOString(),
    }));
    const result = verifyChain(entries);
    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(2);
  });

  it('detects tampering: editing a verdict breaks the chain hash', () => {
    const c1 = buildCertificate(
      {
        certId: 'c1',
        actionRef: 'a1',
        tenantScope: 't',
        checks: allSatisfied(),
        issuedAtMs: 1,
      },
      GENESIS_HASH,
    );
    const tampered = [
      {
        index: 0,
        prevHash: c1.priorHash,
        rowHash: c1.hash,
        payload: {
          certId: c1.certId,
          actionRef: c1.actionRef,
          tenantScope: c1.tenantScope,
          invariantResults: c1.invariantResults,
          verdict: 'allow' as const, // pretend allow…
          issuedAtMs: c1.issuedAtMs,
        },
        sealedAtIso: new Date(c1.issuedAtMs).toISOString(),
      },
    ];
    // Tamper the payload AFTER hashing — the hash no longer commits.
    const broken = [
      {
        ...tampered[0],
        payload: { ...tampered[0].payload, verdict: 'refuse' as const },
      },
    ];
    expect(verifyChain(broken).ok).toBe(false);
  });
});
