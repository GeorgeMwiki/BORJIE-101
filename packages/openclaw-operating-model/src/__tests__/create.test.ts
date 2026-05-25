import { describe, expect, it } from 'vitest';
import { createOpenClawOperatingModel } from '../index.js';

describe('create / createOpenClawOperatingModel', () => {
  it('returns a model with all 4 default in-memory stores', async () => {
    const model = await createOpenClawOperatingModel();
    expect(model.registry).toBeDefined();
    expect(model.policyStore).toBeDefined();
    expect(model.killSwitchStore).toBeDefined();
    expect(model.aaasEndpointStore).toBeDefined();
    expect(model.auditSink).toBeNull();
    expect(model.meteringSink).toBeNull();
    expect(model.dashboardSink).toBeNull();
  });

  it('auto-seeds the 10 shipped domains by default', async () => {
    const model = await createOpenClawOperatingModel();
    const domains = await model.registry.listDomains();
    expect(domains).toHaveLength(10);
  });

  it('autoSeedShippedDomains:false skips seeding', async () => {
    const model = await createOpenClawOperatingModel({
      autoSeedShippedDomains: false,
    });
    const domains = await model.registry.listDomains();
    expect(domains).toHaveLength(0);
  });
});
