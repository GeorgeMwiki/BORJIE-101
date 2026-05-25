import { describe, expect, it } from 'vitest';
import {
  createInMemoryCapabilityRegistry,
  dryRunCapability,
  findCapableAgents,
} from '../capability-registry/index.js';
import type { CapabilityDeclaration } from '../types.js';

function makeCap(
  overrides: Partial<CapabilityDeclaration> = {},
): CapabilityDeclaration {
  return Object.freeze({
    id: overrides.id ?? 'lease.renew',
    name: overrides.name ?? 'Renew lease',
    description: overrides.description ?? 'desc',
    inputs: overrides.inputs ?? { type: 'object', required: ['leaseId'] },
    outputs: overrides.outputs ?? { type: 'object' },
    sideEffects: overrides.sideEffects ?? 'med',
    costEstimateUsdCents: overrides.costEstimateUsdCents ?? 50,
    latencyEstimateMs: overrides.latencyEstimateMs ?? 1500,
    requiredScope: overrides.requiredScope ?? ['tenant:lease:write'],
    jurisdictions: overrides.jurisdictions ?? ['TZ', 'KE'],
    version: overrides.version ?? '1.0.0',
  });
}

describe('capability-registry / register + lookup', () => {
  it('registers and lists capabilities', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await reg.register({ agentId: 'agent-a', capability: makeCap() });
    await reg.register({ agentId: 'agent-b', capability: makeCap() });
    const all = await reg.list();
    expect(all.length).toBe(2);
  });

  it('finds capabilities by exact id', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await reg.register({ agentId: 'agent-a', capability: makeCap() });
    const found = await reg.findByCapabilityId('lease.renew');
    expect(found.length).toBe(1);
    expect(found[0]?.agentId).toBe('agent-a');
  });

  it('finds capabilities by domain prefix', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await reg.register({
      agentId: 'agent-a',
      capability: makeCap({ id: 'lease.renew' }),
    });
    await reg.register({
      agentId: 'agent-b',
      capability: makeCap({ id: 'lease.terminate' }),
    });
    await reg.register({
      agentId: 'agent-c',
      capability: makeCap({ id: 'maintenance.fix' }),
    });
    const found = await reg.findByDomain('lease');
    expect(found.length).toBe(2);
  });

  it('rejects capabilities with empty id', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await expect(
      reg.register({
        agentId: 'agent-a',
        capability: makeCap({ id: '' }),
      }),
    ).rejects.toThrow();
  });

  it('rejects negative cost/latency', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await expect(
      reg.register({
        agentId: 'agent-a',
        capability: makeCap({ costEstimateUsdCents: -1 }),
      }),
    ).rejects.toThrow();
    await expect(
      reg.register({
        agentId: 'agent-a',
        capability: makeCap({ latencyEstimateMs: -1 }),
      }),
    ).rejects.toThrow();
  });
});

describe('capability-registry / findCapable + findCapableAgents', () => {
  it('returns empty when jurisdiction is not in the cap allowlist', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await reg.register({
      agentId: 'agent-a',
      capability: makeCap({ jurisdictions: ['KE'] }),
    });
    const found = await findCapableAgents({
      capabilityId: 'lease.renew',
      tenantId: 't-1',
      jurisdiction: 'TZ',
      autonomyLevel: 'L3',
      capabilities: reg,
    });
    expect(found.length).toBe(0);
  });

  it('returns matches when GLOBAL jurisdiction is declared', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await reg.register({
      agentId: 'agent-a',
      capability: makeCap({ jurisdictions: ['GLOBAL'] }),
    });
    const found = await findCapableAgents({
      capabilityId: 'lease.renew',
      tenantId: 't-1',
      jurisdiction: 'TZ',
      autonomyLevel: 'L3',
      capabilities: reg,
    });
    expect(found.length).toBe(1);
  });
});

describe('capability-registry / dryRunCapability', () => {
  it('forecasts cost + latency without side effects', () => {
    const report = dryRunCapability({
      agentId: 'agent-a',
      capability: makeCap({ costEstimateUsdCents: 120, latencyEstimateMs: 2400 }),
      inputs: { leaseId: 'L-1' },
    });
    expect(report.estimatedCostUsdCents).toBe(120);
    expect(report.estimatedLatencyMs).toBe(2400);
    expect(report.inputsValid).toBe(true);
    expect(report.warnings.length).toBe(0);
  });

  it('flags missing required inputs', () => {
    const report = dryRunCapability({
      agentId: 'agent-a',
      capability: makeCap(),
      inputs: {},
    });
    expect(report.inputsValid).toBe(false);
    expect(report.warnings[0]).toContain('leaseId');
  });

  it('forecasts non-low side effects', () => {
    const report = dryRunCapability({
      agentId: 'agent-a',
      capability: makeCap({ sideEffects: 'critical' }),
      inputs: { leaseId: 'L-1' },
    });
    expect(report.forecastedSideEffects.length).toBeGreaterThan(0);
    expect(report.forecastedSideEffects[0]).toContain('critical');
  });

  it('does not warn for low side effects', () => {
    const report = dryRunCapability({
      agentId: 'agent-a',
      capability: makeCap({ sideEffects: 'low' }),
      inputs: { leaseId: 'L-1' },
    });
    expect(report.forecastedSideEffects.length).toBe(0);
  });
});
