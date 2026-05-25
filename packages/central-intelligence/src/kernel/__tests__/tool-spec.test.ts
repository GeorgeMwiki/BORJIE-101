/**
 * Tests for the BrainToolSpec registry — validates registration,
 * input/output Zod gates, executor failure surfacing, audit-sink
 * persistence, and the 5 seeded property-management tool specs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  createBrainToolRegistry,
  createInMemoryBrainToolAuditSink,
  computeKraMri,
  triageMaintenanceTicket,
  registerSeedBrainTools,
  SEED_BRAIN_TOOL_NAMES,
  type BrainToolRegistry,
  type InMemoryBrainToolAuditSink,
  type LookupTenantArrearsInput,
  type LookupTenantArrearsOutput,
  type CheckComplianceCertificateInput,
  type CheckComplianceCertificateOutput,
  type GetMarketRateBandInput,
  type GetMarketRateBandOutput,
} from '../tool-spec.js';

function makeDeps(): {
  lookupTenantArrears: (i: LookupTenantArrearsInput) => Promise<LookupTenantArrearsOutput>;
  checkComplianceCertificate: (
    i: CheckComplianceCertificateInput,
  ) => Promise<CheckComplianceCertificateOutput>;
  getMarketRateBand: (i: GetMarketRateBandInput) => Promise<GetMarketRateBandOutput>;
} {
  return {
    lookupTenantArrears: async (i: LookupTenantArrearsInput) => ({
      tenantProfileId: i.tenantProfileId,
      arrearsAmount: 25_500,
      currency: 'KES',
      monthsOverdue: 2,
      asOfDate: i.asOfDate ?? '2026-05-14',
    }),
    checkComplianceCertificate: async (i: CheckComplianceCertificateInput) => ({
      certificateId: i.certificateId,
      jurisdiction: i.jurisdiction,
      status: 'valid' as const,
      issuedAt: '2025-01-15',
      expiresAt: '2027-01-14',
      daysUntilExpiry: 245,
    }),
    getMarketRateBand: async (i: GetMarketRateBandInput) => ({
      bedrooms: i.bedrooms,
      unitType: i.unitType,
      currency: 'KES',
      p25: 35_000,
      median: 45_000,
      p75: 60_000,
      sampleSize: 142,
    }),
  };
}

describe('createBrainToolRegistry — core registry behaviour', () => {
  let registry: BrainToolRegistry;
  let sink: InMemoryBrainToolAuditSink;

  beforeEach(() => {
    sink = createInMemoryBrainToolAuditSink();
    registry = createBrainToolRegistry({
      auditSink: sink,
      clock: () => 1_700_000_000_000,
    });
  });

  it('rejects empty name', () => {
    expect(() =>
      registry.register({
        name: '',
        description: 'x',
        schemaIn: z.object({}),
        schemaOut: z.object({}),
        tier: 'free',
        requiresApproval: false,
        executor: async () => ({}),
      }),
    ).toThrow(/name is required/);
  });

  it('rejects duplicate name', () => {
    const spec = {
      name: 'echo',
      description: 'echo',
      schemaIn: z.object({ msg: z.string() }),
      schemaOut: z.object({ msg: z.string() }),
      tier: 'free' as const,
      requiresApproval: false,
      executor: async (input: { msg: string }) => input,
    };
    registry.register(spec);
    expect(() => registry.register(spec)).toThrow(/already registered/);
  });

  it('get returns the registered spec, list returns all', () => {
    registry.register({
      name: 'a',
      description: 'a',
      schemaIn: z.object({}),
      schemaOut: z.object({}),
      tier: 'free',
      requiresApproval: false,
      executor: async () => ({}),
    });
    registry.register({
      name: 'b',
      description: 'b',
      schemaIn: z.object({}),
      schemaOut: z.object({}),
      tier: 'free',
      requiresApproval: false,
      executor: async () => ({}),
    });
    expect(registry.get('a')?.name).toBe('a');
    expect(registry.list().length).toBe(2);
  });

  it('runTool returns not-found for unknown tool', async () => {
    const outcome = await registry.runTool('ghost', {});
    expect(outcome.kind).toBe('not-found');
  });

  it('runTool returns input-invalid for malformed payloads', async () => {
    registry.register({
      name: 'echo',
      description: 'echo',
      schemaIn: z.object({ msg: z.string() }),
      schemaOut: z.object({ msg: z.string() }),
      tier: 'free',
      requiresApproval: false,
      executor: async (i: { msg: string }) => i,
    });
    const outcome = await registry.runTool('echo', { msg: 42 });
    expect(outcome.kind).toBe('input-invalid');
  });

  it('runTool returns output-invalid when executor produces bad shape', async () => {
    registry.register({
      name: 'bad',
      description: 'returns wrong shape',
      schemaIn: z.object({}),
      schemaOut: z.object({ value: z.string() }),
      tier: 'free',
      requiresApproval: false,
      executor: async () => ({ value: 42 }) as unknown as { value: string },
    });
    const outcome = await registry.runTool('bad', {});
    expect(outcome.kind).toBe('output-invalid');
  });

  it('runTool returns executor-failed when executor throws', async () => {
    registry.register({
      name: 'boom',
      description: 'always throws',
      schemaIn: z.object({}),
      schemaOut: z.object({}),
      tier: 'free',
      requiresApproval: false,
      executor: async () => {
        throw new Error('upstream down');
      },
    });
    const outcome = await registry.runTool('boom', {});
    expect(outcome.kind).toBe('executor-failed');
    if (outcome.kind === 'executor-failed') {
      expect(outcome.message).toBe('upstream down');
    }
  });

  it('runTool persists an audit row per call', async () => {
    registry.register({
      name: 'sum',
      description: 'sum',
      schemaIn: z.object({ a: z.number(), b: z.number() }),
      schemaOut: z.object({ result: z.number() }),
      tier: 'pro',
      requiresApproval: false,
      executor: async (i: { a: number; b: number }) => ({ result: i.a + i.b }),
    });
    const outcome = await registry.runTool('sum', { a: 2, b: 3 });
    expect(outcome.kind).toBe('ok');
    const rows = sink.rows();
    expect(rows.length).toBe(1);
    expect(rows[0]!.outcome).toBe('ok');
    expect(rows[0]!.name).toBe('sum');
    expect(rows[0]!.tier).toBe('pro');
  });

  it('runTool audits failed input-validation', async () => {
    registry.register({
      name: 'strict',
      description: 'x',
      schemaIn: z.object({ msg: z.string() }),
      schemaOut: z.object({ msg: z.string() }),
      tier: 'free',
      requiresApproval: false,
      executor: async (i: { msg: string }) => i,
    });
    await registry.runTool('strict', {});
    expect(sink.rows()[0]!.outcome).toBe('input-invalid');
  });
});

describe('Seed property-management tool specs', () => {
  let registry: BrainToolRegistry;

  beforeEach(() => {
    registry = createBrainToolRegistry();
    registerSeedBrainTools(registry, makeDeps());
  });

  it('registers exactly 5 seeded tools', () => {
    expect(registry.list().length).toBe(5);
    expect(SEED_BRAIN_TOOL_NAMES.length).toBe(5);
    for (const name of SEED_BRAIN_TOOL_NAMES) {
      expect(registry.get(name)).not.toBeNull();
    }
  });

  it('lookupTenantArrears returns shape-validated arrears', async () => {
    const outcome = await registry.runTool<LookupTenantArrearsOutput>('lookupTenantArrears', {
      tenantProfileId: 'tp-123',
      asOfDate: '2026-05-14',
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.output.tenantProfileId).toBe('tp-123');
      expect(outcome.output.arrearsAmount).toBe(25_500);
      expect(outcome.output.currency).toBe('KES');
    }
  });

  it('computeKraMri applies 7.5% to in-band monthly rent', async () => {
    const outcome = await registry.runTool('computeKraMri', {
      monthlyRentKes: 50_000,
      monthLabel: '2026-05',
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      const out = outcome.output as { taxDueKes: number; taxRateBps: number; rule: string };
      expect(out.taxRateBps).toBe(750);
      expect(out.taxDueKes).toBe(3_750);
      expect(out.rule).toBe('mri-7.5pct-of-gross');
    }
  });

  it('computeKraMri marks out-of-band when annualised rent exceeds 15M KES', () => {
    const out = computeKraMri({ monthlyRentKes: 2_000_000, monthLabel: '2026-05' });
    expect(out.rule).toBe('out-of-band:not-subject-to-mri');
    expect(out.taxDueKes).toBe(0);
  });

  it('checkComplianceCertificate flows through Zod gates', async () => {
    const outcome = await registry.runTool('checkComplianceCertificate', {
      certificateId: 'cert-fire-001',
      jurisdiction: 'KE',
    });
    expect(outcome.kind).toBe('ok');
  });

  it('getMarketRateBand returns valid quartiles', async () => {
    const outcome = await registry.runTool('getMarketRateBand', {
      bedrooms: 2,
      unitType: '2br',
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      const out = outcome.output as { p25: number; median: number; p75: number };
      expect(out.p25).toBeLessThanOrEqual(out.median);
      expect(out.median).toBeLessThanOrEqual(out.p75);
    }
  });

  it('triageMaintenanceTicket flags safety codes as critical', () => {
    const out = triageMaintenanceTicket({
      ticketId: 't1',
      problemCode: 'safety.fire',
      description: 'smoke detector keeps beeping',
    });
    expect(out.severity).toBe('critical');
    expect(out.slaWindowHours).toBe(4);
  });

  it('triageMaintenanceTicket flags no-water as high', () => {
    const out = triageMaintenanceTicket({
      ticketId: 't2',
      problemCode: 'plumbing.water',
      description: 'no water since this morning',
    });
    expect(out.severity).toBe('high');
    expect(out.slaWindowHours).toBe(24);
  });

  it('triageMaintenanceTicket flags cosmetic as low', () => {
    const out = triageMaintenanceTicket({
      ticketId: 't3',
      problemCode: 'paint.touchup',
      description: 'hairline crack in cosmetic paint',
    });
    expect(out.severity).toBe('low');
    expect(out.slaWindowHours).toBe(168);
  });
});
