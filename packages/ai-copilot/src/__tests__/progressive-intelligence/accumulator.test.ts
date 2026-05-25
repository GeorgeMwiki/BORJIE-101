/**
 * Progressive Intelligence — tests for accumulator, extraction, mapping,
 * validation, version history, section gating, research triggers,
 * auto-generation, and teaching hints.
 */

import { describe, it, expect } from 'vitest';
import {
  createContextAccumulator,
  extractFromMessage,
  firstMatch,
  inferMaintenanceCategory,
  findBestMapping,
  validateAccumulatedContext,
  assertLeaseCommitReady,
  assertMaintenanceCommitReady,
  InMemoryVersionHistoryRepository,
  createVersionHistoryService,
  createDynamicSectionManager,
  createResearchService,
  InMemoryResearchClient,
  createResearchTriggerHub,
  createAutoGenerationService,
  evaluateTeachingHints,
  renderTeachingHintsAsPromptSegment,
} from '../../progressive-intelligence/index.js';

// ---------------------------------------------------------------------------
// extraction patterns
// ---------------------------------------------------------------------------

describe('extractFromMessage', () => {
  it('finds Tanzanian phone numbers', () => {
    const matches = extractFromMessage('Please call +255712345678 tomorrow');
    const phone = firstMatch(matches, 'phone_tz');
    expect(phone).not.toBeNull();
    expect(phone?.normalized).toBe('+255712345678');
  });

  it('finds Kenyan phone numbers', () => {
    const matches = extractFromMessage('Reach me on 0712345678 any time');
    const phone = firstMatch(matches, 'phone_ke');
    expect(phone?.normalized).toBe('+254712345678');
  });

  it('finds amounts', () => {
    const matches = extractFromMessage('the monthly rent is TZS 450,000');
    const amount = firstMatch(matches, 'amount');
    expect(amount?.normalized).toBe(450000);
  });

  it('finds duration_months', () => {
    const matches = extractFromMessage('lease runs for 12 months starting 2026-05-01');
    const duration = firstMatch(matches, 'duration_months');
    expect(duration?.normalized).toBe(12);
  });

  it('handles empty input', () => {
    expect(extractFromMessage('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// field mappings
// ---------------------------------------------------------------------------

describe('field mappings', () => {
  it('classifies plumbing keywords', () => {
    const inferred = inferMaintenanceCategory('the bathroom has been leaking for 3 weeks');
    expect(inferred?.category).toBe('plumbing');
  });

  it('picks the highest-priority mapping for a phone match', () => {
    const match = {
      kind: 'phone_tz' as const,
      raw: '+255712345678',
      normalized: '+255712345678',
      confidence: 0.9,
      offset: 0,
    };
    const mapping = findBestMapping(match);
    expect(mapping?.targetPath).toBe('tenantProfile.phone');
  });
});

// ---------------------------------------------------------------------------
// accumulator
// ---------------------------------------------------------------------------

describe('ContextAccumulatorService', () => {
  it('rejects empty tenantId', () => {
    const acc = createContextAccumulator();
    expect(() => acc.initializeContext('s1', '')).toThrow(/tenantId/);
  });

  it('initializes an empty context', () => {
    const acc = createContextAccumulator();
    const ctx = acc.initializeContext('s1', 't1');
    expect(ctx.version).toBe(1);
    expect(ctx.sessionId).toBe('s1');
    expect(ctx.tenantId).toBe('t1');
  });

  it('bumps version on every update', () => {
    const acc = createContextAccumulator();
    acc.initializeContext('s1', 't1');
    const first = acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.propertyRef',
      value: 'LR 123/456',
      source: 'form',
      confidence: 0.9,
    });
    expect(first.version).toBe(2);
    const second = acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.unitLabel',
      value: '4B',
      source: 'form',
      confidence: 0.9,
    });
    expect(second.version).toBe(3);
  });

  it('emits a change event on update', () => {
    const acc = createContextAccumulator();
    const events: string[] = [];
    acc.onChange((e) => events.push(e.type));
    acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.propertyRef',
      value: 'LR 123',
      source: 'chat',
      confidence: 0.9,
    });
    expect(events).toContain('field_updated');
  });

  it('isolates contexts across tenants', () => {
    const acc = createContextAccumulator();
    acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.propertyRef',
      value: 'LR 111',
      source: 'form',
      confidence: 0.9,
    });
    acc.updateField({
      sessionId: 's1',
      tenantId: 't2',
      path: 'property.propertyRef',
      value: 'LR 222',
      source: 'form',
      confidence: 0.9,
    });
    const a = acc.getContext('s1', 't1');
    const b = acc.getContext('s1', 't2');
    expect(a?.property.propertyRef).toBe('LR 111');
    expect(b?.property.propertyRef).toBe('LR 222');
  });

  it('ingests chat messages and maps fields', () => {
    const acc = createContextAccumulator();
    const { updatedContext } = acc.ingestChatMessage({
      sessionId: 's1',
      tenantId: 't1',
      text:
        'the bathroom has been leaking for 3 weeks — please call +255712345678',
      attachmentsUrls: ['https://cdn/photo-1.jpg'],
    });
    expect(updatedContext.maintenanceCase.category).toBe('plumbing');
    expect(updatedContext.maintenanceCase.evidence?.length).toBe(1);
    expect(updatedContext.tenantProfile.phone).toBe('+255712345678');
    expect(updatedContext.tenantProfile.countryCode).toBe('TZ');
  });

  it('ingests LPMS rows into migration batch + lease terms', () => {
    const acc = createContextAccumulator();
    const ctx = acc.ingestLpmsRow({
      sessionId: 's1',
      tenantId: 't1',
      sourceSystem: 'PMS-XYZ',
      sourceFile: 'units-export.csv',
      row: {
        tenant_name: 'John Doe',
        phone: '+254712345678',
        monthly_rent: 45000,
        lease_start: '2026-05-01',
        tenure_months: 12,
        property_ref: 'LR 123/456',
      },
    });
    expect(ctx.migrationBatch.sourceSystem).toBe('PMS-XYZ');
    expect(ctx.leaseTerms.monthlyRentCents).toBe(4500000);
    expect(ctx.leaseTerms.tenureMonths).toBe(12);
    expect(ctx.property.propertyRef).toBe('LR 123/456');
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('accepts an empty context as valid (all fields optional)', () => {
    const acc = createContextAccumulator();
    const ctx = acc.initializeContext('s1', 't1');
    const report = validateAccumulatedContext(ctx);
    expect(report.valid).toBe(true);
  });

  it('rejects invalid phone format', () => {
    const acc = createContextAccumulator();
    const ctx = acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'tenantProfile.phone',
      value: 'not-a-phone',
      source: 'form',
      confidence: 1,
    });
    const report = validateAccumulatedContext(ctx);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.section === 'tenantProfile')).toBe(true);
  });

  it('assertLeaseCommitReady blocks incomplete lease', () => {
    expect(() =>
      assertLeaseCommitReady({ monthlyRentCents: 100_00 }),
    ).toThrow(/commit-ready/);
  });

  it('assertMaintenanceCommitReady allows a full case', () => {
    expect(() =>
      assertMaintenanceCommitReady({
        category: 'plumbing',
        severity: 'medium',
        description: 'leak',
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// version history
// ---------------------------------------------------------------------------

describe('version history', () => {
  it('appends and rewinds', async () => {
    const repo = new InMemoryVersionHistoryRepository();
    const svc = createVersionHistoryService(repo);
    const acc = createContextAccumulator();
    const v1 = acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.propertyRef',
      value: 'LR 111',
      source: 'form',
      confidence: 0.9,
    });
    await svc.snapshot(v1);
    const v2 = acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.propertyRef',
      value: 'LR 222',
      source: 'form',
      confidence: 0.9,
    });
    await svc.snapshot(v2);

    const rewound = await svc.rewindTo('t1', 's1', v1.version);
    expect(rewound?.property.propertyRef).toBe('LR 111');
  });

  it('rejects cross-tenant append', async () => {
    const repo = new InMemoryVersionHistoryRepository();
    await expect(
      repo.append({
        id: 'x',
        tenantId: 't1',
        sessionId: 's1',
        version: 1,
        context: {
          sessionId: 's1',
          tenantId: 't2', // mismatched!
          createdAt: '',
          updatedAt: '',
          property: {},
          tenantProfile: {},
          leaseTerms: {},
          maintenanceCase: {},
          migrationBatch: {},
          renewalProposal: {},
          complianceNotice: {},
          fieldMetadata: {},
          version: 1,
        },
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/tenantId/);
  });
});

// ---------------------------------------------------------------------------
// dynamic section manager
// ---------------------------------------------------------------------------

describe('dynamic section manager', () => {
  it('locks tenantProfile until property is ≥80% complete', () => {
    const mgr = createDynamicSectionManager();
    const readiness = {
      sessionId: 's1',
      overallPct: 25,
      sections: [
        {
          sectionId: 'property',
          completionPct: 50,
          filledCount: 1,
          totalCount: 2,
          missingFields: ['property.unitLabel'],
          canGenerate: false,
        },
        {
          sectionId: 'tenantProfile',
          completionPct: 0,
          filledCount: 0,
          totalCount: 3,
          missingFields: [],
          canGenerate: false,
        },
      ],
      suggestions: [],
    };
    expect(mgr.isUnlocked('tenantProfile', readiness)).toBe(false);
    expect(mgr.isUnlocked('property', readiness)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// research triggers
// ---------------------------------------------------------------------------

describe('research triggers', () => {
  it('fires on district update', async () => {
    const acc = createContextAccumulator();
    const client = new InMemoryResearchClient({
      rent: {
        'DAR-KINONDONI::residential': {
          district: 'DAR-KINONDONI',
          unitType: 'residential',
          medianRentCents: 500_00_000,
          sampleSize: 5,
          fetchedAt: new Date().toISOString(),
        },
      },
    });
    const research = createResearchService(client);
    const hub = createResearchTriggerHub(acc, research);
    hub.start();

    acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.district',
      value: 'DAR-KINONDONI',
      source: 'form',
      confidence: 1,
    });

    // Allow async triggers to flush
    await new Promise((r) => setTimeout(r, 20));
    hub.stop();
  });
});

// ---------------------------------------------------------------------------
// auto-generation
// ---------------------------------------------------------------------------

describe('auto-generation service', () => {
  it('builds a preview from LPMS rows', async () => {
    const acc = createContextAccumulator();
    const svc = createAutoGenerationService(acc);
    const preview = await svc.buildPreview({
      tenantId: 't1',
      sessionId: 's1',
      sourceSystem: 'PMS-XYZ',
      sourceFile: 'units.csv',
      rows: [
        {
          rowIndex: 0,
          data: {
            tenant_name: 'Alice',
            phone: '+255712345678',
            monthly_rent: 400000,
            lease_start: '2026-04-01',
            tenure_months: 12,
          },
        },
        {
          rowIndex: 1,
          data: {
            tenant_name: 'Bob',
            phone: '+254712345678',
            monthly_rent: 45000,
            lease_start: '2026-04-15',
            tenure_months: 24,
          },
        },
      ],
    });
    expect(preview.rowCountTotal).toBe(2);
    expect(preview.rowCountParsed).toBe(2);
    expect(preview.firstRowContext).not.toBeNull();
  });

  it('blocks commit without writer', async () => {
    const acc = createContextAccumulator();
    const svc = createAutoGenerationService(acc);
    await expect(
      svc.commit({ tenantId: 't1', sessionId: 's1', rows: [] }),
    ).rejects.toThrow(/no MigrationWriter/);
  });

  it('rejects cross-tenant commit rows', async () => {
    const acc = createContextAccumulator();
    const writer = {
      commit: async (): Promise<{ commitedRowCount: number; writerRef: string }> => ({
        commitedRowCount: 0,
        writerRef: 'x',
      }),
    };
    const svc = createAutoGenerationService(acc, writer);
    const otherTenantCtx = acc.updateField({
      sessionId: 's1',
      tenantId: 't2',
      path: 'property.propertyRef',
      value: 'LR 1',
      source: 'form',
      confidence: 1,
    });
    await expect(
      svc.commit({ tenantId: 't1', sessionId: 's1', rows: [otherTenantCtx] }),
    ).rejects.toThrow(/cross-tenant/);
  });
});

// ---------------------------------------------------------------------------
// teaching hints
// ---------------------------------------------------------------------------

describe('teaching hints', () => {
  it('fires rent-affordability hint when ratio exceeds 33%', () => {
    const acc = createContextAccumulator();
    let ctx = acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'tenantProfile.monthlyIncomeCents',
      value: 1_000_000,
      source: 'form',
      confidence: 1,
    });
    ctx = acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'leaseTerms.monthlyRentCents',
      value: 500_000,
      source: 'form',
      confidence: 1,
    });
    const hints = evaluateTeachingHints(ctx);
    expect(hints.some((h) => h.id === 'rent_affordability_high')).toBe(true);
  });

  it('renders hints as markdown segment', () => {
    const segment = renderTeachingHintsAsPromptSegment([
      {
        id: 'rent_affordability_high',
        title: 'Ratio above 33%',
        explanation: 'test',
        dataSnapshot: {},
      },
    ]);
    expect(segment).toContain('Teaching Hints');
    expect(segment).toContain('Ratio above 33%');
  });
});

// ---------------------------------------------------------------------------
// readiness
// ---------------------------------------------------------------------------

describe('readiness report', () => {
  it('reports 0% on empty context', () => {
    const acc = createContextAccumulator();
    acc.initializeContext('s1', 't1');
    const report = acc.computeReadiness('s1', 't1');
    expect(report.overallPct).toBe(0);
  });

  it('reports progress as fields fill in', () => {
    const acc = createContextAccumulator();
    acc.updateField({
      sessionId: 's1',
      tenantId: 't1',
      path: 'property.propertyRef',
      value: 'LR 1',
      source: 'form',
      confidence: 1,
    });
    const report = acc.computeReadiness('s1', 't1');
    expect(report.overallPct).toBeGreaterThan(0);
  });
});
