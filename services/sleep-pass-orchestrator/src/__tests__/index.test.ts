import { describe, expect, it } from 'vitest';
import {
  createAuditChainVerifyPass,
  createCacheWarmUpPass,
  createDataQualityCheckPass,
  createDeadLetterReplayPass,
  createDormantTenantDetectorPass,
  createExpiredTokenCleanupPass,
  createIndexMaintenancePass,
  createInMemoryAuditChainAdapter,
  createInMemoryCacheAdapter,
  createInMemoryDataQualityAdapter,
  createInMemoryDeadLetterAdapter,
  createInMemoryIndexAdapter,
  createInMemoryMetricsAdapter,
  createInMemoryTenantAdapter,
  createInMemoryTokenAdapter,
  createMetricsRollupPass,
  createOrchestrator,
} from '../index.js';

describe('orchestrator wiring (smoke)', () => {
  it('accepts all 8 passes simultaneously', async () => {
    const passes = [
      createDeadLetterReplayPass(createInMemoryDeadLetterAdapter()),
      createCacheWarmUpPass(createInMemoryCacheAdapter(), []),
      createDataQualityCheckPass(createInMemoryDataQualityAdapter()),
      createIndexMaintenancePass(createInMemoryIndexAdapter()),
      createAuditChainVerifyPass(createInMemoryAuditChainAdapter([])),
      createExpiredTokenCleanupPass(createInMemoryTokenAdapter()),
      createMetricsRollupPass(createInMemoryMetricsAdapter()),
      createDormantTenantDetectorPass(createInMemoryTenantAdapter()),
    ];
    let t = new Date('2026-05-25T10:00:00.000Z').getTime();
    const orch = createOrchestrator({
      passes,
      now: () => new Date(t),
    });
    expect(orch.decide().considered).toHaveLength(8);
    t += 60 * 60_000;
    const out = await orch.tick();
    expect(out.results.length).toBeGreaterThan(0);
  });

  it('start/stop are idempotent (smoke)', () => {
    const orch = createOrchestrator({
      passes: [],
    });
    orch.start();
    orch.start();
    orch.stop();
    orch.stop();
  });
});
