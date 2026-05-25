import { describe, it, expect, afterEach } from 'vitest';
import { getBottleneckAnalysisTool } from '../../src/tools/get_bottleneck_analysis.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_bottleneck_analysis', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('describes a topK input bounded 1..100', () => {
    expect(getBottleneckAnalysisTool.inputSchema.properties.topK?.maximum).toBe(
      100,
    );
    expect(getBottleneckAnalysisTool.inputSchema.required).toEqual(
      expect.arrayContaining(['tenantId', 'processId']),
    );
  });

  it('defaults topK to 10 when omitted', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: { processId: 'p1', edges: [] },
    }));

    await getBottleneckAnalysisTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args.topK).toBe(10);
  });

  it('returns edges sorted by severity (from the sidecar)', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        edges: [
          {
            fromActivity: 'submit',
            toActivity: 'approve',
            meanWaitSeconds: 3600,
            p95WaitSeconds: 7200,
            caseCount: 50,
            severityScore: 180000,
          },
        ],
      },
    }));

    const result = await getBottleneckAnalysisTool.execute(
      { tenantId: 't1', processId: 'p1', topK: 5 },
      { pm4py: sidecar.client },
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.severityScore).toBe(180000);
  });
});
