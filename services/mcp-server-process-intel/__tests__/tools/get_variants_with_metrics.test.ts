import { describe, it, expect, afterEach } from 'vitest';
import { getVariantsWithMetricsTool } from '../../src/tools/get_variants_with_metrics.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_variants_with_metrics', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('returns variants with frequency + duration stats', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        totalCases: 100,
        variants: [
          {
            variantId: 'v1',
            activities: ['submit', 'approve', 'close'],
            caseCount: 60,
            sharePercent: 60,
            meanDurationSeconds: 3600,
            p50DurationSeconds: 3000,
            p95DurationSeconds: 7200,
          },
        ],
      },
    }));

    const result = await getVariantsWithMetricsTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(result.totalCases).toBe(100);
    expect(result.variants[0]?.sharePercent).toBe(60);
  });

  it('defaults topK to 20', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: { processId: 'p1', totalCases: 0, variants: [] },
    }));

    await getVariantsWithMetricsTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args.topK).toBe(20);
  });
});
