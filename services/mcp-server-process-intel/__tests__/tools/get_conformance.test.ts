import { describe, it, expect, afterEach } from 'vitest';
import { getConformanceTool } from '../../src/tools/get_conformance.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_conformance', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('defaults modelSource to discovered_happy_path', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        fitness: 0.85,
        precision: 0.7,
        generalisation: 0.6,
        simplicity: 0.9,
        violations: [],
      },
    }));

    await getConformanceTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args.modelSource).toBe(
      'discovered_happy_path',
    );
  });

  it('returns the four conformance scores from token replay', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        fitness: 0.92,
        precision: 0.81,
        generalisation: 0.65,
        simplicity: 0.88,
        violations: [
          {
            violationType: 'missing_token',
            activity: 'approve',
            caseCount: 7,
          },
        ],
      },
    }));

    const result = await getConformanceTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(result.fitness).toBeCloseTo(0.92);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.violationType).toBe('missing_token');
  });
});
