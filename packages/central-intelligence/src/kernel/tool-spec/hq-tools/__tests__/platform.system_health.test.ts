import { describe, it, expect } from 'vitest';
import {
  computeOverallState,
  createSystemHealthTool,
  type ServiceHeartbeatPort,
} from '../platform.system_health.js';
import { buildCtx, makeInMemoryOtel } from './test-rig.js';

function stub(rows: Parameters<typeof computeOverallState>[0]): ServiceHeartbeatPort {
  return {
    async readSnapshot() {
      return rows;
    },
  };
}

describe('platform.system_health', () => {
  it('happy path — all healthy → overall healthy', async () => {
    const tool = createSystemHealthTool({
      heartbeats: stub([
        {
          serviceName: 'api-gateway',
          state: 'healthy',
          lastHeartbeatAt: '2026-05-15T09:00:00.000Z',
          latencyMsP95: 35,
          notes: null,
        },
        {
          serviceName: 'consolidation-worker',
          state: 'healthy',
          lastHeartbeatAt: '2026-05-15T08:59:00.000Z',
          latencyMsP95: null,
          notes: null,
        },
      ]),
    });
    const out = await tool.execute({}, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.overall).toBe('healthy');
    expect(out.output.services).toHaveLength(2);
  });

  it('worst-state wins — degraded + unhealthy → unhealthy', () => {
    expect(
      computeOverallState([
        {
          serviceName: 'a',
          state: 'degraded',
          lastHeartbeatAt: null,
          latencyMsP95: null,
          notes: null,
        },
        {
          serviceName: 'b',
          state: 'unhealthy',
          lastHeartbeatAt: null,
          latencyMsP95: null,
          notes: null,
        },
      ]),
    ).toBe('unhealthy');
  });

  it('auth-gated — caller without ops:read is refused', async () => {
    const tool = createSystemHealthTool({ heartbeats: stub([]) });
    const out = await tool.execute(
      {},
      buildCtx({ scopes: ['platform:tenants:read'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('includeNotes=false strips notes', async () => {
    const tool = createSystemHealthTool({
      heartbeats: stub([
        {
          serviceName: 'redis',
          state: 'healthy',
          lastHeartbeatAt: '2026-05-15T09:00:00.000Z',
          latencyMsP95: 2,
          notes: 'secret upstream link',
        },
      ]),
    });
    const out = await tool.execute({ includeNotes: false }, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.services[0].notes).toBeNull();
  });

  it('emits OTel span name', async () => {
    const otel = makeInMemoryOtel();
    const tool = createSystemHealthTool({ heartbeats: stub([]) });
    await tool.execute({}, buildCtx({ otel }));
    expect(otel.spans[0].name).toBe('tool.platform.system_health');
  });
});
