/**
 * Knowledge-source registry tests.
 *
 * Wave BLACKBOARD-CORE. Verifies:
 *   - register stamps default priority from the kind taxonomy
 *   - listForRegion filters by regionFilter (empty filter == all)
 *   - cross-tenant lookup returns null
 *   - explicit priority override sticks
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.1, §5.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryKnowledgeSourcesRepository,
  createKnowledgeSourceRegistry,
  BLACKBOARD_CONSTANTS,
} from '../index.js';

describe('ks-registry — register + filter by region', () => {
  it('default priority follows the kind taxonomy', async () => {
    const repo = createInMemoryKnowledgeSourcesRepository();
    const registry = createKnowledgeSourceRegistry({ repository: repo });
    const userKs = await registry.register({
      tenantId: 't1',
      ksKind: 'user',
      ksName: 'safety-officer-human',
    });
    expect(userKs.priority).toBe(BLACKBOARD_CONSTANTS.DEFAULT_KS_PRIORITY.user);
    const toolKs = await registry.register({
      tenantId: 't1',
      ksKind: 'tool',
      ksName: 'royalty-calculator',
    });
    expect(toolKs.priority).toBe(BLACKBOARD_CONSTANTS.DEFAULT_KS_PRIORITY.tool);
  });

  it('listForRegion gates by regionFilter (empty filter = all)', async () => {
    const repo = createInMemoryKnowledgeSourcesRepository();
    const registry = createKnowledgeSourceRegistry({ repository: repo });
    await registry.register({
      tenantId: 't1',
      ksKind: 'junior',
      ksName: 'mining-planner',
      regionFilter: ['incident-investigation'],
    });
    await registry.register({
      tenantId: 't1',
      ksKind: 'connector',
      ksName: 'tmaa-filing',
      regionFilter: ['royalty-filing-prep'],
    });
    await registry.register({
      tenantId: 't1',
      ksKind: 'user',
      ksName: 'owner',
      regionFilter: [],
    });
    const ksForIncident = await registry.listForRegion(
      't1',
      'incident-investigation',
    );
    const names = ksForIncident.map((k) => k.ksName).sort();
    expect(names).toContain('mining-planner');
    expect(names).toContain('owner');
    expect(names).not.toContain('tmaa-filing');
  });

  it('cross-tenant getById returns null', async () => {
    const repo = createInMemoryKnowledgeSourcesRepository();
    const registry = createKnowledgeSourceRegistry({ repository: repo });
    const ks = await registry.register({
      tenantId: 't1',
      ksKind: 'junior',
      ksName: 'geology-advisor',
    });
    expect(await registry.getById('t2', ks.id)).toBeNull();
    expect(await registry.getById('t1', ks.id)).not.toBeNull();
  });

  it('explicit priority override sticks', async () => {
    const repo = createInMemoryKnowledgeSourcesRepository();
    const registry = createKnowledgeSourceRegistry({ repository: repo });
    const ks = await registry.register({
      tenantId: 't1',
      ksKind: 'connector',
      ksName: 'lme-prices',
      priority: 0.95,
    });
    expect(ks.priority).toBeCloseTo(0.95, 5);
  });
});
