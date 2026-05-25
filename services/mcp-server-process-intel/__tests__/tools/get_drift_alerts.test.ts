import { describe, it, expect, afterEach } from 'vitest';
import { getDriftAlertsTool } from '../../src/tools/get_drift_alerts.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_drift_alerts', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('defaults to monthly windows, 6 lookback, 0.05 significance', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: { processId: 'p1', windowSize: 'monthly', alerts: [] },
    }));

    await getDriftAlertsTool.execute(
      { tenantId: 't1', processId: 'p1' },
      { pm4py: sidecar.client },
    );

    expect(sidecar.commandsSeen[0]?.args).toMatchObject({
      windowSize: 'monthly',
      lookbackWindows: 6,
      significanceLevel: 0.05,
    });
  });

  it('returns alerts with severity buckets', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processId: 'p1',
        windowSize: 'weekly',
        alerts: [
          {
            metric: 'cycle_time_mean',
            windowStart: '2026-04-01T00:00:00Z',
            windowEnd: '2026-05-01T00:00:00Z',
            priorValue: 3000,
            currentValue: 4500,
            deltaPercent: 50,
            pValue: 0.0005,
            severity: 'high',
          },
        ],
      },
    }));

    const result = await getDriftAlertsTool.execute(
      {
        tenantId: 't1',
        processId: 'p1',
        windowSize: 'weekly',
      },
      { pm4py: sidecar.client },
    );

    expect(result.alerts[0]?.severity).toBe('high');
    expect(result.alerts[0]?.deltaPercent).toBe(50);
  });
});
