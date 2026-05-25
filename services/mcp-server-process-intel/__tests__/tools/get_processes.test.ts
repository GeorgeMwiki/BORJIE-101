import { describe, it, expect, afterEach } from 'vitest';
import { getProcessesTool } from '../../src/tools/get_processes.js';
import { createMockSidecar } from '../test-helpers.js';

describe('process_intel.get_processes', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('declares the MS-PA-compatible tool descriptor', () => {
    expect(getProcessesTool.name).toBe('process_intel.get_processes');
    expect(getProcessesTool.inputSchema.required).toContain('tenantId');
    expect(getProcessesTool.inputSchema.properties.since?.format).toBe(
      'date-time',
    );
    expect(getProcessesTool.outputSchema.required).toContain('processes');
  });

  it('forwards args to the pm4py sidecar and returns the data envelope', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: {
        processes: [
          {
            processId: 'lease-renewal',
            name: 'Lease Renewal',
            eventCount: 1200,
            caseCount: 80,
            firstEvent: '2026-01-01T00:00:00Z',
            lastEvent: '2026-05-01T00:00:00Z',
          },
        ],
      },
    }));

    const result = await getProcessesTool.execute(
      { tenantId: 't1', since: '2026-01-01T00:00:00Z' },
      { pm4py: sidecar.client },
    );

    expect(result.processes).toHaveLength(1);
    expect(result.processes[0]?.processId).toBe('lease-renewal');
    expect(sidecar.commandsSeen[0]?.kind).toBe('get_processes');
    expect(sidecar.commandsSeen[0]?.args).toMatchObject({
      tenantId: 't1',
      since: '2026-01-01T00:00:00Z',
    });
  });

  it('throws Pm4pySidecarError when the sidecar reports failure', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: false,
      error: 'event-log fetch failed',
      errorCode: 'FETCH_FAILED',
    }));

    await expect(
      getProcessesTool.execute(
        { tenantId: 't1' },
        { pm4py: sidecar.client },
      ),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });
});
