/**
 * Heartbeat engine tests — Wave-11.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createHeartbeatEngine,
  DEFAULT_HEARTBEAT_CADENCE_MS,
} from '../heartbeat/heartbeat-engine.js';

describe('heartbeat-engine', () => {
  it('puts idle juniors to sleep after the idle window', async () => {
    let now = 1_000_000;
    const onSleep = vi.fn();
    const engine = createHeartbeatEngine({
      now: () => now,
      juniorIdleMs: 5 * 60 * 1000,
      onJuniorSleep: onSleep,
    });
    const result = await engine.tick({
      activeTenantIds: ['t1'],
      juniors: [
        {
          sessionId: 's-idle',
          tenantId: 't1',
          lastActivityAt: now - 6 * 60 * 1000,
          awake: true,
        },
        {
          sessionId: 's-active',
          tenantId: 't1',
          lastActivityAt: now - 30_000,
          awake: true,
        },
      ],
    });
    expect(result.juniorsPutToSleep).toEqual(['s-idle']);
    expect(result.juniorsKeptAwake).toEqual(['s-active']);
    expect(onSleep).toHaveBeenCalledWith('s-idle');
  });

  it('wake() overrides idle-sleep on the next tick', async () => {
    let now = 1_000_000;
    const engine = createHeartbeatEngine({
      now: () => now,
      juniorIdleMs: 1_000,
    });
    engine.wake('s-important');
    const result = await engine.tick({
      activeTenantIds: [],
      juniors: [
        {
          sessionId: 's-important',
          tenantId: 't1',
          lastActivityAt: now - 999_999,
          awake: true,
        },
      ],
    });
    expect(result.juniorsPutToSleep).toEqual([]);
    expect(result.juniorsKeptAwake).toEqual(['s-important']);
  });

  it('probes LLM health and reports status', async () => {
    const engine = createHeartbeatEngine({
      now: () => 0,
      probeLlmHealth: async () => false,
    });
    const result = await engine.tick({ activeTenantIds: [], juniors: [] });
    expect(result.llmHealthy).toBe(false);
  });

  it('rolls ledgers + sweeps memory per active tenant', async () => {
    const rolled: string[] = [];
    const swept: string[] = [];
    const engine = createHeartbeatEngine({
      now: () => 0,
      rollLedger: async (t) => {
        rolled.push(t);
      },
      sweepMemoryForTenant: async (t) => {
        swept.push(t);
      },
    });
    const result = await engine.tick({
      activeTenantIds: ['t1', 't2'],
      juniors: [],
    });
    expect(rolled).toEqual(['t1', 't2']);
    expect(swept).toEqual(['t1', 't2']);
    expect(result.ledgersRolled).toBe(2);
    expect(result.memorySweeps).toBe(2);
  });

  it('default cadence is 30 s', () => {
    expect(DEFAULT_HEARTBEAT_CADENCE_MS).toBe(30_000);
    const engine = createHeartbeatEngine({ now: () => 0 });
    expect(engine.cadenceMs).toBe(DEFAULT_HEARTBEAT_CADENCE_MS);
  });
});
