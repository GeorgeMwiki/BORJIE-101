import { describe, expect, it } from 'vitest';

import {
  type CapabilityField,
  DisclosureTier,
  FIELD_TIER,
  HIGH_RISK_FIELDS,
  NEVER_FIELDS,
  SAFE_FIELDS,
  discloseField,
  discloseFieldWithReason,
  filterDisclosurePayload,
} from '../index.js';

describe('tier-taxonomy: FIELD_TIER inventory', () => {
  it('exposes exactly 30 fields', () => {
    expect(Object.keys(FIELD_TIER)).toHaveLength(30);
  });

  it('partitions into 10 SAFE + 9 HIGH_RISK + 11 NEVER', () => {
    expect(SAFE_FIELDS).toHaveLength(10);
    expect(HIGH_RISK_FIELDS).toHaveLength(9);
    expect(NEVER_FIELDS).toHaveLength(11);
  });

  it('every field is in exactly one tier list', () => {
    const fields = new Set<CapabilityField>([
      ...SAFE_FIELDS,
      ...HIGH_RISK_FIELDS,
      ...NEVER_FIELDS,
    ]);
    expect(fields.size).toBe(30);
  });

  it('SAFE_FIELDS all map to DisclosureTier.SAFE', () => {
    for (const f of SAFE_FIELDS) expect(FIELD_TIER[f]).toBe(DisclosureTier.SAFE);
  });

  it('HIGH_RISK_FIELDS all map to DisclosureTier.HIGH_RISK', () => {
    for (const f of HIGH_RISK_FIELDS) expect(FIELD_TIER[f]).toBe(DisclosureTier.HIGH_RISK);
  });

  it('NEVER_FIELDS all map to DisclosureTier.NEVER', () => {
    for (const f of NEVER_FIELDS) expect(FIELD_TIER[f]).toBe(DisclosureTier.NEVER);
  });

  it('FIELD_TIER is frozen (cannot mutate)', () => {
    expect(Object.isFrozen(FIELD_TIER)).toBe(true);
    expect(Object.isFrozen(SAFE_FIELDS)).toBe(true);
  });
});

describe('tier-taxonomy: critical canonical routings', () => {
  // These canonical mappings are load-bearing for legal compliance.
  it('identityAsAI is SAFE (EU AI Act Art. 50)', () => {
    expect(FIELD_TIER.identityAsAI).toBe(DisclosureTier.SAFE);
  });
  it('recoursePath is SAFE (GDPR Art. 22)', () => {
    expect(FIELD_TIER.recoursePath).toBe(DisclosureTier.SAFE);
  });
  it('llmModelNameVersion is HIGH_RISK (vendor leak)', () => {
    expect(FIELD_TIER.llmModelNameVersion).toBe(DisclosureTier.HIGH_RISK);
  });
  it('systemPromptText is NEVER (trade secret)', () => {
    expect(FIELD_TIER.systemPromptText).toBe(DisclosureTier.NEVER);
  });
  it('vendorCredentials is NEVER (catastrophic)', () => {
    expect(FIELD_TIER.vendorCredentials).toBe(DisclosureTier.NEVER);
  });
  it('rawLlmReasoningTrace is NEVER (architecture leak)', () => {
    expect(FIELD_TIER.rawLlmReasoningTrace).toBe(DisclosureTier.NEVER);
  });
});

describe('tier-taxonomy: discloseField gate logic', () => {
  it('SAFE field is visible to a SAFE-cleared principal', () => {
    expect(discloseField('featureCatalogue', DisclosureTier.SAFE)).toBe(true);
  });
  it('HIGH_RISK field is hidden from a SAFE-cleared principal', () => {
    expect(discloseField('llmModelNameVersion', DisclosureTier.SAFE)).toBe(false);
  });
  it('HIGH_RISK field is visible to a HIGH_RISK-cleared principal', () => {
    expect(discloseField('llmModelNameVersion', DisclosureTier.HIGH_RISK)).toBe(true);
  });
  it('NEVER field is hidden from a HIGH_RISK-cleared principal', () => {
    expect(discloseField('systemPromptText', DisclosureTier.HIGH_RISK)).toBe(false);
  });
  it('NEVER field is visible to a NEVER-cleared (security-team) principal', () => {
    expect(discloseField('systemPromptText', DisclosureTier.NEVER)).toBe(true);
  });
  it('unknown field fails closed', () => {
    expect(discloseField('madeUpField' as CapabilityField, DisclosureTier.NEVER)).toBe(false);
  });
});

describe('tier-taxonomy: discloseFieldWithReason returns audit shape', () => {
  it('returns allowed=true with positive reason when cleared', () => {
    const r = discloseFieldWithReason('featureCatalogue', DisclosureTier.SAFE);
    expect(r.allowed).toBe(true);
    expect(r.fieldTier).toBe(DisclosureTier.SAFE);
    expect(r.reason).toMatch(/cleared/);
  });
  it('returns allowed=false with reason when blocked', () => {
    const r = discloseFieldWithReason('systemPromptText', DisclosureTier.SAFE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/below/);
  });
  it('unknown field returns NEVER tier + fail-closed reason', () => {
    const r = discloseFieldWithReason('madeUp' as CapabilityField, DisclosureTier.NEVER);
    expect(r.allowed).toBe(false);
    expect(r.fieldTier).toBe(DisclosureTier.NEVER);
    expect(r.reason).toBe('unknown-field-fail-closed');
  });
});

describe('tier-taxonomy: filterDisclosurePayload (bulk filter)', () => {
  const payload = {
    featureCatalogue: ['rent', 'screening'],
    llmModelNameVersion: 'claude-opus-4-7',
    systemPromptText: 'You are…',
  };

  it('SAFE principal: keeps SAFE, drops HIGH_RISK + NEVER', () => {
    const { disclosed, refused } = filterDisclosurePayload(payload, DisclosureTier.SAFE);
    expect(disclosed.featureCatalogue).toBeDefined();
    expect(disclosed.llmModelNameVersion).toBeUndefined();
    expect(disclosed.systemPromptText).toBeUndefined();
    expect(refused).toContain('llmModelNameVersion');
    expect(refused).toContain('systemPromptText');
  });

  it('HIGH_RISK principal: keeps SAFE + HIGH_RISK, drops NEVER', () => {
    const { disclosed, refused } = filterDisclosurePayload(payload, DisclosureTier.HIGH_RISK);
    expect(disclosed.featureCatalogue).toBeDefined();
    expect(disclosed.llmModelNameVersion).toBeDefined();
    expect(disclosed.systemPromptText).toBeUndefined();
    expect(refused).toEqual(['systemPromptText']);
  });

  it('does not mutate the input object', () => {
    const original = { featureCatalogue: ['rent'] };
    const before = JSON.stringify(original);
    filterDisclosurePayload(original, DisclosureTier.SAFE);
    expect(JSON.stringify(original)).toBe(before);
  });
});
