import { describe, it, expect, afterEach } from 'vitest';
import { getLoopAnalysisTool } from '../../src/tools/get_loop_analysis.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_loop_analysis', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('declares enum-valid pattern types in the output schema', () => {
    const pattern = (getLoopAnalysisTool.outputSchema.properties.patterns as {
      items: { properties: { patternType: { enum: ReadonlyArray<string> } } };
    }).items.properties.patternType.enum;
    expect(pattern).toEqual(['self_loop', 'short_loop', 'long_loop']);
  });

  it('defaults minOccurrences to 3', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: { processId: 'p1', patterns: [] },
    }));

    await getLoopAnalysisTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args.minOccurrences).toBe(3);
  });

  it('returns loop patterns with iteration + extra-wait metrics', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        patterns: [
          {
            patternType: 'self_loop',
            activities: ['review'],
            occurrenceCount: 15,
            affectedCaseCount: 10,
            avgIterations: 2.5,
            avgExtraWaitSeconds: 1800,
          },
        ],
      },
    }));

    const result = await getLoopAnalysisTool.execute(
      { tenantId: 't1', processId: 'p1', minOccurrences: 5 },
      { pm4py: sidecar.client },
    );

    expect(result.patterns[0]?.patternType).toBe('self_loop');
    expect(result.patterns[0]?.avgIterations).toBe(2.5);
  });
});
