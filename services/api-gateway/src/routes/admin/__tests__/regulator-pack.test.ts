/**
 * Regulator-pack builder — unit tests.
 *
 * The export bundles four tenant-scoped corpora into ONE verifiable artifact:
 *   - audit bundle        (audit_events)
 *   - compliance filings  (regulatory_filings + compliance_exports)
 *   - evidence chain      (ai_audit_chain hash-chained entries)
 *
 * Verifiability:
 *   - `bundleHash` is a deterministic sha256 over the canonical contents
 *     (stable key order — re-hashing the same contents reproduces it)
 *   - `bundleSignature` is HMAC-sha256(bundleHash, secret); null when no
 *     secret is supplied (dev)
 *   - `verifyRegulatorPack(bundle, secret)` recomputes both and reports
 *     tamper status — flipping a single byte fails verification.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRegulatorPack,
  verifyRegulatorPack,
  type RegulatorPackSources,
} from '../regulator-pack';

const SOURCES: RegulatorPackSources = {
  auditEvents: [
    { id: 'ae_1', action: 'PAYMENT.create', outcome: 'SUCCESS', timestampMs: 1000 },
    { id: 'ae_2', action: 'LEASE.terminate', outcome: 'DENIED', timestampMs: 2000 },
  ],
  regulatoryFilings: [
    { id: 'rf_1', regulator: 'tra', filingType: 'royalty_return', status: 'submitted' },
  ],
  complianceExports: [
    { id: 'ce_1', exportType: 'tz_tra', status: 'ready', fileChecksum: 'abc123' },
  ],
  evidenceChain: [
    { sequenceId: 1, thisHash: 'h1', prevHash: 'GENESIS', action: 'turn.start' },
    { sequenceId: 2, thisHash: 'h2', prevHash: 'h1', action: 'turn.commit' },
  ],
};

const META = {
  tenantId: 'tn_acme',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-03-31T23:59:59.000Z',
  generatedAt: '2026-06-01T00:00:00.000Z',
  requestedBy: 'admin_a',
  approvedBy: 'admin_b',
};

describe('buildRegulatorPack', () => {
  it('produces a bundle carrying all four corpora + counts', () => {
    const bundle = buildRegulatorPack(SOURCES, META, 'secret-key');
    expect(bundle.bundleVersion).toBe(1);
    expect(bundle.tenantId).toBe('tn_acme');
    expect(bundle.sections.auditEvents).toHaveLength(2);
    expect(bundle.sections.regulatoryFilings).toHaveLength(1);
    expect(bundle.sections.complianceExports).toHaveLength(1);
    expect(bundle.sections.evidenceChain).toHaveLength(2);
    expect(bundle.counts).toMatchObject({
      auditEvents: 2,
      regulatoryFilings: 1,
      complianceExports: 1,
      evidenceChain: 2,
    });
    expect(bundle.fourEye).toMatchObject({
      requestedBy: 'admin_a',
      approvedBy: 'admin_b',
    });
  });

  it('is deterministic — same inputs reproduce the same bundleHash', () => {
    const a = buildRegulatorPack(SOURCES, META, 'secret-key');
    const b = buildRegulatorPack(SOURCES, META, 'secret-key');
    expect(a.bundleHash).toBe(b.bundleHash);
    expect(a.bundleHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs the hash when a secret is supplied, null otherwise', () => {
    const signed = buildRegulatorPack(SOURCES, META, 'secret-key');
    const unsigned = buildRegulatorPack(SOURCES, META, null);
    expect(signed.bundleSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(unsigned.bundleSignature).toBeNull();
  });

  it('embeds a per-section evidence-chain continuity check', () => {
    const bundle = buildRegulatorPack(SOURCES, META, 'secret-key');
    // The two seeded entries chain (h1 -> prevHash of seq2), so continuous.
    expect(bundle.evidenceChainContinuous).toBe(true);

    const broken = buildRegulatorPack(
      {
        ...SOURCES,
        evidenceChain: [
          { sequenceId: 1, thisHash: 'h1', prevHash: 'GENESIS', action: 'a' },
          { sequenceId: 2, thisHash: 'h2', prevHash: 'WRONG', action: 'b' },
        ],
      },
      META,
      'secret-key',
    );
    expect(broken.evidenceChainContinuous).toBe(false);
  });
});

describe('verifyRegulatorPack', () => {
  it('verifies an untampered, signed bundle', () => {
    const bundle = buildRegulatorPack(SOURCES, META, 'secret-key');
    const result = verifyRegulatorPack(bundle, 'secret-key');
    expect(result.hashValid).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('detects content tampering (hash mismatch)', () => {
    const bundle = buildRegulatorPack(SOURCES, META, 'secret-key');
    const tampered = {
      ...bundle,
      sections: {
        ...bundle.sections,
        // Flip an audit outcome — the recomputed hash must diverge.
        auditEvents: [
          { id: 'ae_1', action: 'PAYMENT.create', outcome: 'FAILURE', timestampMs: 1000 },
          ...bundle.sections.auditEvents.slice(1),
        ],
      },
    };
    const result = verifyRegulatorPack(tampered, 'secret-key');
    expect(result.hashValid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('detects a wrong signing secret (signature mismatch)', () => {
    const bundle = buildRegulatorPack(SOURCES, META, 'secret-key');
    const result = verifyRegulatorPack(bundle, 'WRONG-secret');
    expect(result.hashValid).toBe(true);
    expect(result.signatureValid).toBe(false);
    expect(result.valid).toBe(false);
  });
});
