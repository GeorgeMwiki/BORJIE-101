import { describe, it, expect, afterEach } from 'vitest';
import { getCorrelationTool } from '../../src/tools/get_correlation.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_correlation', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('defaults the target metric to cycle_time', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: { processId: 'p1', target: 'cycle_time', correlations: [] },
    }));

    await getCorrelationTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args.target).toBe('cycle_time');
  });

  it('marks features with sampleSize < 30 as lowSample', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        target: 'cycle_time',
        correlations: [
          {
            attribute: 'region',
            attributeType: 'categorical',
            coefficient: 0.42,
            pValue: 0.001,
            sampleSize: 25,
            lowSample: true,
          },
          {
            attribute: 'amount',
            attributeType: 'numeric',
            coefficient: 0.6,
            pValue: 0.0001,
            sampleSize: 200,
            lowSample: false,
          },
        ],
      },
    }));

    const result = await getCorrelationTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(result.correlations[0]?.lowSample).toBe(true);
    expect(result.correlations[1]?.lowSample).toBe(false);
  });
});
