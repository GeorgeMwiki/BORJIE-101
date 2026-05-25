import { describe, it, expect, afterEach } from 'vitest';
import { getHandoffMatrixTool } from '../../src/tools/get_handoff_matrix.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_handoff_matrix', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('defaults includeCentrality to false', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: { processId: 'p1', handoffs: [], centrality: [] },
    }));

    await getHandoffMatrixTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args.includeCentrality).toBe(false);
  });

  it('returns handoff edges and centrality when requested', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        handoffs: [
          {
            fromResource: 'alice',
            toResource: 'bob',
            handoffCount: 42,
            avgWaitSeconds: 600,
          },
        ],
        centrality: [
          { resource: 'alice', degreeCentrality: 0.7, betweennessCentrality: 0.4 },
        ],
      },
    }));

    const result = await getHandoffMatrixTool.execute(
      { tenantId: 't1', processId: 'p1', includeCentrality: true },
      { pm4py: sidecar.client },
    );

    expect(result.handoffs[0]?.handoffCount).toBe(42);
    expect(result.centrality[0]?.resource).toBe('alice');
  });
});
