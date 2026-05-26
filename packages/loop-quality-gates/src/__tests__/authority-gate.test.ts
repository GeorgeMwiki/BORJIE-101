import { describe, it, expect } from 'vitest';
import {
  authorityGate,
  type MutationAuthorityPort,
} from '../gates/authority-gate.js';

const portAlwaysDoubleVerify: MutationAuthorityPort = {
  requiresDoubleVerify: () => true,
};
const portNeverDoubleVerify: MutationAuthorityPort = {
  requiresDoubleVerify: () => false,
};

describe('authority-gate', () => {
  it('passes when proposed tier is within granted tier and not T2-Critical', () => {
    const r = authorityGate(
      { proposedTier: 1, grantedTier: 2, proposalKind: 'doc.draft' },
      portNeverDoubleVerify,
    );
    expect(r.pass).toBe(true);
    expect(r.signal.signal).toBe('authority');
  });

  it('fails when proposed tier exceeds granted tier', () => {
    const r = authorityGate(
      { proposedTier: 2, grantedTier: 1, proposalKind: 'gepg.payment' },
      portNeverDoubleVerify,
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('exceeds-granted');
  });

  it('fails T2 proposals when double-verify is required', () => {
    const r = authorityGate(
      { proposedTier: 2, grantedTier: 2, proposalKind: 'gepg.payment' },
      portAlwaysDoubleVerify,
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('double-verify');
  });
});
