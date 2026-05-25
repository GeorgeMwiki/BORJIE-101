import { describe, expect, it } from 'vitest';
import {
  CitationSchema,
  ExecutiveBriefSchema,
  FindingSchema,
  HypothesisSchema,
} from '../types.js';

describe('CitationSchema', () => {
  it('accepts a citation with entityId', () => {
    const r = CitationSchema.safeParse({
      claimIndex: 0,
      claimKind: 'gap',
      entityId: 'ent_1',
    });
    expect(r.success).toBe(true);
  });
  it('accepts a citation with auditEventId', () => {
    const r = CitationSchema.safeParse({
      claimIndex: 0,
      claimKind: 'risk',
      auditEventId: 'aud_1',
    });
    expect(r.success).toBe(true);
  });
  it('rejects a citation with no concrete evidence', () => {
    const r = CitationSchema.safeParse({
      claimIndex: 0,
      claimKind: 'gap',
    });
    expect(r.success).toBe(false);
  });
});

describe('FindingSchema', () => {
  it('requires at least one citationIndex', () => {
    const r = FindingSchema.safeParse({
      title: 'No citations',
      description: 'A claim with no backing.',
      severity: 'HIGH',
      citationIndices: [],
    });
    expect(r.success).toBe(false);
  });
  it('accepts a finding with one citation', () => {
    const r = FindingSchema.safeParse({
      title: 'OK',
      description: 'Cited claim.',
      severity: 'HIGH',
      citationIndices: [0],
    });
    expect(r.success).toBe(true);
  });
});

describe('HypothesisSchema', () => {
  it('accepts a well-formed hypothesis', () => {
    const r = HypothesisSchema.safeParse({
      kind: 'risk',
      title: 'Lease expiring',
      description: 'Foo bar.',
      severity: 'HIGH',
      evidenceRefs: [{ kind: 'entity', id: 'ent_lease_1' }],
    });
    expect(r.success).toBe(true);
  });
  it('defaults evidenceRefs to empty array', () => {
    const r = HypothesisSchema.safeParse({
      kind: 'gap',
      title: 'X',
      description: 'Y',
      severity: 'LOW',
    });
    expect(r.success).toBe(true);
  });
});

describe('ExecutiveBriefSchema', () => {
  const baseBrief = {
    id: 'ebr_1',
    tenantId: 'ten_1',
    personaId: 'pers_1',
    scope: { modules: [], timeWindow: 'P7D', focusEntities: [] },
    gaps: [],
    opportunities: [],
    risks: [],
    recommendedActions: [],
    approvalPackets: [],
    citations: [],
    locale: 'en',
    generatedAt: new Date(),
    periodStart: new Date('2026-05-15'),
    periodEnd: new Date('2026-05-22'),
    generatorVersion: 'v1',
    hash: 'abc',
    prevHash: null,
    auditChainLink: null,
    status: 'GENERATED',
  };

  it('accepts an empty (no findings) brief', () => {
    const r = ExecutiveBriefSchema.safeParse(baseBrief);
    expect(r.success).toBe(true);
  });

  it('refuses a brief whose finding citationIndex is out of bounds', () => {
    const r = ExecutiveBriefSchema.safeParse({
      ...baseBrief,
      gaps: [
        {
          title: 'X',
          description: 'Y',
          severity: 'HIGH',
          citationIndices: [99],
        },
      ],
      citations: [
        { claimIndex: 0, claimKind: 'gap', entityId: 'ent_1' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('refuses a brief whose timeWindow is malformed', () => {
    const r = ExecutiveBriefSchema.safeParse({
      ...baseBrief,
      scope: { modules: [], timeWindow: 'not-iso', focusEntities: [] },
    });
    expect(r.success).toBe(false);
  });

  it('accepts a brief with cited findings', () => {
    const r = ExecutiveBriefSchema.safeParse({
      ...baseBrief,
      gaps: [
        {
          title: 'X',
          description: 'Y',
          severity: 'HIGH',
          citationIndices: [0],
        },
      ],
      citations: [
        { claimIndex: 0, claimKind: 'gap', entityId: 'ent_1' },
      ],
    });
    expect(r.success).toBe(true);
  });
});
