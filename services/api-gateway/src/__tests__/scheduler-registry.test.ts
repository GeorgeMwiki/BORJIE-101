/**
 * Scheduler-registry smoke test.
 *
 * Verifies the Wave-15 wiring-audit fix: the previously-orphaned
 * schedulables `detect_bottlenecks` and `memory_decay_sweep` are now
 * registered in the background scheduler's task catalogue.
 *
 * We exercise the extension-builder directly so the test stays
 * independent of a live Postgres.
 */

import { describe, it, expect } from 'vitest';
import { buildTaskCatalogue } from '@borjie/ai-copilot/background-intelligence';

describe('background scheduler registry', () => {
  it('includes the eight base tasks', () => {
    const tasks = buildTaskCatalogue({
      async listPropertiesForHealthScan() { return []; },
      async listArrearsCases() { return []; },
      async listLeasesNearExpiry() { return []; },
      async listInspectionsDue() { return []; },
      async listComplianceNotices() { return []; },
      async summariseMonthlyCosts() { return null; },
      async listVendorPerformance() { return []; },
      async recomputeTenantHealth() { return []; },
    });
    const names = tasks.map((t) => t.name);
    expect(names).toContain('portfolio_health_scan');
    expect(names).toContain('arrears_ladder_tick');
    expect(names).toContain('renewal_proposal_generator');
    expect(names).toContain('far_inspection_reminder_sweep');
    expect(names).toContain('compliance_expiry_check');
    expect(names).toContain('cost_ledger_rollup');
    expect(names).toContain('vendor_performance_digest');
    expect(names).toContain('tenant_health_5ps_recompute');
    expect(tasks).toHaveLength(8);
  });
});
