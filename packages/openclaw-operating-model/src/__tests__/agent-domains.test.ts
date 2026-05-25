import { describe, expect, it } from 'vitest';
import {
  InMemoryAgentRegistry,
  recommendedDefaultAutonomy,
  seedShippedDomains,
  SHIPPED_DOMAINS,
  SHIPPED_DOMAIN_VERSION,
  type AgentDomain,
} from '../index.js';

describe('agent-domains / pre-shipped catalog', () => {
  it('ships exactly 10 domains', () => {
    expect(SHIPPED_DOMAINS).toHaveLength(10);
  });

  it('contains the 10 expected domain ids', () => {
    const ids = new Set(SHIPPED_DOMAINS.map((d) => d.id));
    expect(ids).toEqual(
      new Set([
        'lease-renewal',
        'rent-collection',
        'maintenance-dispatch',
        'tenant-onboarding',
        'marketplace-listing',
        'procurement-rfq',
        'inspection-scheduling',
        'report-generation',
        'payment-reconciliation',
        'marketing-content',
      ]),
    );
  });

  it('all domains carry the same shipped version stamp', () => {
    for (const domain of SHIPPED_DOMAINS) {
      expect(domain.version).toBe(SHIPPED_DOMAIN_VERSION);
    }
  });

  it('every domain has at least one allowedTool and at least one data scope', () => {
    for (const domain of SHIPPED_DOMAINS) {
      expect(domain.allowedTools.length).toBeGreaterThan(0);
      expect(domain.dataAccessScope.length).toBeGreaterThan(0);
      expect(domain.escalationOwner.length).toBeGreaterThan(0);
    }
  });

  it('payment-reconciliation is classified critical and defaults to L2', () => {
    const d = SHIPPED_DOMAINS.find((x) => x.id === 'payment-reconciliation');
    expect(d?.riskClass).toBe('critical');
    expect(d?.defaultAutonomyLevel).toBe('L2');
  });

  it('marketing-content is classified low and defaults to L4', () => {
    const d = SHIPPED_DOMAINS.find((x) => x.id === 'marketing-content');
    expect(d?.riskClass).toBe('low');
    expect(d?.defaultAutonomyLevel).toBe('L4');
  });
});

describe('agent-domains / recommendedDefaultAutonomy', () => {
  it('critical → L2', () => {
    expect(recommendedDefaultAutonomy('critical')).toBe('L2');
  });
  it('high → L3', () => {
    expect(recommendedDefaultAutonomy('high')).toBe('L3');
  });
  it('med → L3', () => {
    expect(recommendedDefaultAutonomy('med')).toBe('L3');
  });
  it('low → L4', () => {
    expect(recommendedDefaultAutonomy('low')).toBe('L4');
  });
});

describe('agent-domains / registry + seed', () => {
  it('seedShippedDomains loads all 10 domains', async () => {
    const registry = new InMemoryAgentRegistry();
    const count = await seedShippedDomains(registry);
    expect(count).toBe(10);
    const domains = await registry.listDomains();
    expect(domains).toHaveLength(10);
  });

  it('registerDomain supports tenant extensibility', async () => {
    const registry = new InMemoryAgentRegistry();
    const custom: AgentDomain = {
      id: 'custom-domain',
      name: 'Custom Domain',
      description: 'Tenant-specific',
      riskClass: 'med',
      defaultAutonomyLevel: 'L3',
      allowedTools: ['custom_tool'],
      dataAccessScope: ['custom_table'],
      escalationOwner: 'tenant_admin',
      version: '1.0.0',
    };
    await registry.registerDomain(custom);
    const fetched = await registry.getDomain('custom-domain');
    expect(fetched?.name).toBe('Custom Domain');
  });

  it('getAutonomyLevel falls back to domain default', async () => {
    const registry = new InMemoryAgentRegistry();
    await seedShippedDomains(registry);
    const level = await registry.getAutonomyLevel({
      agentId: 'agent-a',
      domainId: 'marketing-content',
    });
    expect(level).toBe('L4');
  });

  it('setAutonomyLevel overrides default; tenant-scoped beats global', async () => {
    const registry = new InMemoryAgentRegistry();
    await seedShippedDomains(registry);
    await registry.setAutonomyLevel({
      agentId: 'agent-a',
      domainId: 'rent-collection',
      level: 'L2',
      justification: 'Default policy',
      setBy: 'admin',
    });
    await registry.setAutonomyLevel({
      agentId: 'agent-a',
      domainId: 'rent-collection',
      tenantId: 'tenant-9',
      level: 'L1',
      justification: 'Tenant conservative posture',
      setBy: 'tenant-cao',
    });
    const tenantLevel = await registry.getAutonomyLevel({
      agentId: 'agent-a',
      domainId: 'rent-collection',
      tenantId: 'tenant-9',
    });
    const globalLevel = await registry.getAutonomyLevel({
      agentId: 'agent-a',
      domainId: 'rent-collection',
    });
    expect(tenantLevel).toBe('L1');
    expect(globalLevel).toBe('L2');
  });
});
