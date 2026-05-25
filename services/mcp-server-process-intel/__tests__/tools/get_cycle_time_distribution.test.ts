import { describe, it, expect, afterEach } from 'vitest';
import { getCycleTimeDistributionTool } from '../../src/tools/get_cycle_time_distribution.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_cycle_time_distribution', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('defaults bucketCount to 20 and logScale to false', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        totalCases: 0,
        stats: {
          minSeconds: 0,
          meanSeconds: 0,
          medianSeconds: 0,
          p90Seconds: 0,
          p95Seconds: 0,
          p99Seconds: 0,
          maxSeconds: 0,
          stdDevSeconds: 0,
        },
        buckets: [],
      },
    }));

    await getCycleTimeDistributionTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args.bucketCount).toBe(20);
    expect(sidecar.commandsSeen[0]?.args.logScale).toBe(false);
  });

  it('returns the full percentile bundle', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        totalCases: 500,
        stats: {
          minSeconds: 60,
          meanSeconds: 3600,
          medianSeconds: 3000,
          p90Seconds: 7200,
          p95Seconds: 9000,
          p99Seconds: 14400,
          maxSeconds: 18000,
          stdDevSeconds: 1500,
        },
        buckets: [
          { lowerBoundSeconds: 0, upperBoundSeconds: 900, caseCount: 50 },
        ],
      },
    }));

    const result = await getCycleTimeDistributionTool.execute(
      { tenantId: 't1', processId: 'p1', bucketCount: 5, logScale: true },
      { pm4py: sidecar.client },
    );

    expect(result.stats.p95Seconds).toBe(9000);
    expect(result.totalCases).toBe(500);
    expect(result.buckets).toHaveLength(1);
  });
});
