import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_LEVELS,
  applyJurisdictionCap,
  assignAutonomyLevel,
  DEFAULT_JURISDICTION_CAPS,
  evaluateAction,
  InMemoryAgentRegistry,
  levelGte,
  levelMin,
  levelRank,
  lookupJurisdictionCap,
} from '../index.js';

describe('autonomy-ladders / level helpers', () => {
  it('exposes 6 levels L0..L5 in order', () => {
    expect(AUTONOMY_LEVELS).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
  });

  it('levelRank returns 0..5 index', () => {
    expect(levelRank('L0')).toBe(0);
    expect(levelRank('L5')).toBe(5);
  });

  it('levelGte compares numerically', () => {
    expect(levelGte('L3', 'L1')).toBe(true);
    expect(levelGte('L1', 'L3')).toBe(false);
    expect(levelGte('L3', 'L3')).toBe(true);
  });

  it('levelMin returns the lower of two levels', () => {
    expect(levelMin('L3', 'L1')).toBe('L1');
    expect(levelMin('L5', 'L2')).toBe('L2');
    expect(levelMin('L4', 'L4')).toBe('L4');
  });
});

describe('autonomy-ladders / jurisdiction caps', () => {
  it('TZ critical risk caps at L3', () => {
    const cap = lookupJurisdictionCap('TZ', 'critical');
    expect(cap.maxLevel).toBe('L3');
    expect(cap.jurisdiction).toBe('TZ');
  });

  it('TZ low risk allows L5', () => {
    const cap = lookupJurisdictionCap('TZ', 'low');
    expect(cap.maxLevel).toBe('L5');
  });

  it('KE high risk caps at L4', () => {
    const cap = lookupJurisdictionCap('KE', 'high');
    expect(cap.maxLevel).toBe('L4');
  });

  it('Unknown jurisdiction falls back to GLOBAL', () => {
    const cap = lookupJurisdictionCap('ET', 'critical');
    expect(cap.maxLevel).toBe('L3');
  });

  it('applyJurisdictionCap caps over-permissive request', () => {
    const result = applyJurisdictionCap({
      requested: 'L5',
      jurisdiction: 'TZ',
      riskClass: 'critical',
    });
    expect(result.effective).toBe('L3');
    expect(result.requested).toBe('L5');
    expect(result.capApplied).not.toBeNull();
  });

  it('applyJurisdictionCap permits request within ceiling', () => {
    const result = applyJurisdictionCap({
      requested: 'L2',
      jurisdiction: 'TZ',
      riskClass: 'critical',
    });
    expect(result.effective).toBe('L2');
    expect(result.capApplied).toBeNull();
  });

  it('DEFAULT_JURISDICTION_CAPS covers all 4 risk classes for TZ/KE/UG + GLOBAL', () => {
    const jurisdictions = new Set(DEFAULT_JURISDICTION_CAPS.map((c) => c.jurisdiction));
    expect(jurisdictions.has('TZ')).toBe(true);
    expect(jurisdictions.has('KE')).toBe(true);
    expect(jurisdictions.has('UG')).toBe(true);
    expect(jurisdictions.has('GLOBAL')).toBe(true);
  });
});

describe('autonomy-ladders / evaluateAction per-level semantics', () => {
  it('read actions always allowed', () => {
    for (const lvl of AUTONOMY_LEVELS) {
      const r = evaluateAction({
        autonomyLevel: lvl,
        action: { kind: 'read', stakes: 'critical', inEnvelope: false, costUsdCents: 0 },
      });
      expect(r.decision).toBe('allow');
    }
  });

  it('L0 blocks any mutation', () => {
    const r = evaluateAction({
      autonomyLevel: 'L0',
      action: { kind: 'mutate', stakes: 'low', inEnvelope: true, costUsdCents: 0 },
    });
    expect(r.decision).toBe('block');
  });

  it('L1 requires approval for every mutation', () => {
    const r = evaluateAction({
      autonomyLevel: 'L1',
      action: { kind: 'mutate', stakes: 'low', inEnvelope: true, costUsdCents: 0 },
    });
    expect(r.decision).toBe('require_approval');
  });

  it('L2 allows low-stakes mutations', () => {
    const r = evaluateAction({
      autonomyLevel: 'L2',
      action: { kind: 'mutate', stakes: 'low', inEnvelope: true, costUsdCents: 0 },
    });
    expect(r.decision).toBe('allow');
  });

  it('L2 requires approval for high-stakes mutations', () => {
    const r = evaluateAction({
      autonomyLevel: 'L2',
      action: { kind: 'mutate', stakes: 'high', inEnvelope: true, costUsdCents: 0 },
    });
    expect(r.decision).toBe('require_approval');
  });

  it('L3 allows in-envelope, escalates out-of-envelope', () => {
    const inEnvelope = evaluateAction({
      autonomyLevel: 'L3',
      action: { kind: 'mutate', stakes: 'med', inEnvelope: true, costUsdCents: 0 },
    });
    const outEnvelope = evaluateAction({
      autonomyLevel: 'L3',
      action: { kind: 'mutate', stakes: 'med', inEnvelope: false, costUsdCents: 0 },
    });
    expect(inEnvelope.decision).toBe('allow');
    expect(outEnvelope.decision).toBe('require_approval');
  });

  it('L3 requires approval for critical even when in envelope', () => {
    const r = evaluateAction({
      autonomyLevel: 'L3',
      action: { kind: 'mutate', stakes: 'critical', inEnvelope: true, costUsdCents: 0 },
    });
    expect(r.decision).toBe('require_approval');
  });

  it('L4 allows by default but escalates above cost ceiling', () => {
    const ok = evaluateAction({
      autonomyLevel: 'L4',
      action: { kind: 'mutate', stakes: 'high', inEnvelope: true, costUsdCents: 50_000 },
    });
    const too_costly = evaluateAction({
      autonomyLevel: 'L4',
      action: { kind: 'mutate', stakes: 'high', inEnvelope: true, costUsdCents: 200_000 },
      costEscalationCeilingUsdCents: 100_000,
    });
    expect(ok.decision).toBe('allow');
    expect(too_costly.decision).toBe('require_approval');
  });

  it('L4 escalates on anomaly above threshold', () => {
    const r = evaluateAction({
      autonomyLevel: 'L4',
      action: {
        kind: 'mutate',
        stakes: 'med',
        inEnvelope: true,
        costUsdCents: 100,
        anomalyScore: 0.95,
      },
      anomalyEscalationThreshold: 0.8,
    });
    expect(r.decision).toBe('require_approval');
  });

  it('L5 allows action of any stakes', () => {
    const r = evaluateAction({
      autonomyLevel: 'L5',
      action: {
        kind: 'mutate',
        stakes: 'critical',
        inEnvelope: false,
        costUsdCents: 999_999,
      },
    });
    expect(r.decision).toBe('allow');
  });

  it('destroy action requires approval below L5', () => {
    const r = evaluateAction({
      autonomyLevel: 'L4',
      action: { kind: 'destroy', stakes: 'critical', inEnvelope: true, costUsdCents: 0 },
    });
    expect(r.decision).toBe('require_approval');
  });
});

describe('autonomy-ladders / assignAutonomyLevel', () => {
  it('requires justification of >= 8 chars', async () => {
    const registry = new InMemoryAgentRegistry();
    await expect(() =>
      assignAutonomyLevel({
        registry,
        input: {
          agentId: 'agent-1',
          domainId: 'rent-collection',
          requestedLevel: 'L3',
          jurisdiction: 'TZ',
          riskClass: 'high',
          justification: 'short',
          setBy: 'user-1',
        },
      }),
    ).rejects.toThrow(/justification/);
  });

  it('caps requested level by jurisdiction ceiling', async () => {
    const registry = new InMemoryAgentRegistry();
    const result = await assignAutonomyLevel({
      registry,
      input: {
        agentId: 'agent-1',
        domainId: 'payment-reconciliation',
        requestedLevel: 'L5',
        jurisdiction: 'TZ',
        riskClass: 'critical',
        justification: 'Initial pilot under regulator supervision',
        setBy: 'cao-georg',
      },
    });
    expect(result.effectiveLevel).toBe('L3');
    expect(result.requestedLevel).toBe('L5');
    expect(result.capApplied).not.toBeNull();
  });

  it('records the change to the registry audit trail', async () => {
    const registry = new InMemoryAgentRegistry();
    await assignAutonomyLevel({
      registry,
      input: {
        agentId: 'agent-x',
        domainId: 'marketing-content',
        tenantId: 'tenant-7',
        requestedLevel: 'L4',
        jurisdiction: 'KE',
        riskClass: 'low',
        justification: 'Approved by tenant CAO Jane Mwende',
        setBy: 'cao-jane',
      },
    });
    const audit = registry.getAutonomyAuditTrail();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.agentId).toBe('agent-x');
    expect(audit[0]?.level).toBe('L4');
    expect(audit[0]?.tenantId).toBe('tenant-7');
  });
});
