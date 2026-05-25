/**
 * Killswitch — unit tests.
 *
 * Verifies:
 *   - env-port reads HALT / DEGRADED / LIVE correctly
 *   - per-tenant state takes precedence over platform state
 *   - HALT-tenant overrides DEGRADED-platform and vice versa
 *   - invalid env values fail-open to LIVE
 *   - reason codes are validated against the documented set
 *   - refusal copy never leaks the reason code
 *   - kernel `think()` short-circuits on HALT (no sensor call)
 *   - kernel `thinkStream()` short-circuits on HALT (no deltas)
 *   - DEGRADED is non-fatal — the kernel proceeds
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createBrainKernel,
  createEnvKillswitchPort,
  renderKillswitchRefusalText,
  resolveKillswitch,
  type KillswitchState,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
} from '../../kernel/index.js';
import type { ScopeContext } from '../../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_alpha',
  actorUserId: 'u_demo',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th-1',
    userMessage: 'check the rent ledger',
    scope: TENANT_SCOPE,
    tier: 'property',
    stakes: 'medium',
    surface: 'estate-manager-app',
    ...over,
  };
}

function scriptedSensor(): { sensor: Sensor; calls: number } {
  let calls = 0;
  const sensor: Sensor = {
    id: 'fake-sensor',
    modelId: 'fake-model',
    priority: 1,
    capabilities: ['fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      calls++;
      return {
        text: 'rent ledger looks healthy',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'fake-model',
        sensorId: 'fake-sensor',
      };
    },
  };
  return {
    sensor,
    get calls() {
      return calls;
    },
  } as unknown as { sensor: Sensor; calls: number };
}

describe('env killswitch port', () => {
  it('returns LIVE when no env vars are set', () => {
    const port = createEnvKillswitchPort({});
    expect(port.readPlatform().level).toBe('live');
    expect(port.readTenant('t_alpha')).toBeNull();
  });

  it('reads platform HALT with reason code', () => {
    const port = createEnvKillswitchPort({
      KILLSWITCH_STATE: 'halt',
      KILLSWITCH_REASON: 'COMPLIANCE_HOLD_CBK',
    });
    const state = port.readPlatform();
    expect(state.level).toBe('halt');
    expect(state.reasonCode).toBe('COMPLIANCE_HOLD_CBK');
  });

  it('parses level case-insensitively', () => {
    expect(
      createEnvKillswitchPort({ KILLSWITCH_STATE: 'HALT' })
        .readPlatform()
        .level,
    ).toBe('halt');
    expect(
      createEnvKillswitchPort({ KILLSWITCH_STATE: 'Degraded' })
        .readPlatform()
        .level,
    ).toBe('degraded');
  });

  it('fails-open to LIVE on unknown level string', () => {
    expect(
      createEnvKillswitchPort({ KILLSWITCH_STATE: 'banana' })
        .readPlatform()
        .level,
    ).toBe('live');
  });

  it('falls back to a documented reason code on unknown KILLSWITCH_REASON', () => {
    const port = createEnvKillswitchPort({
      KILLSWITCH_STATE: 'halt',
      KILLSWITCH_REASON: 'NOT_A_REAL_CODE',
    });
    expect(port.readPlatform().reasonCode).toBe('KILLSWITCH_HALT');
  });

  it('reads per-tenant HALT', () => {
    const port = createEnvKillswitchPort({
      KILLSWITCH_TENANT_t_alpha: 'halt',
      KILLSWITCH_TENANT_t_alpha_REASON: 'TENANT_DATA_LEAK_SUSPECTED',
    });
    const state = port.readTenant('t_alpha');
    expect(state?.level).toBe('halt');
    expect(state?.reasonCode).toBe('TENANT_DATA_LEAK_SUSPECTED');
  });

  it('returns null for a tenant with no override', () => {
    const port = createEnvKillswitchPort({
      KILLSWITCH_TENANT_t_alpha: 'halt',
    });
    expect(port.readTenant('t_other')).toBeNull();
  });
});

describe('resolveKillswitch precedence', () => {
  function port(state: Readonly<{
    platform?: KillswitchState;
    tenants?: Record<string, KillswitchState>;
  }>) {
    return {
      readPlatform: () =>
        state.platform ?? ({ level: 'live', reasonCode: 'KILLSWITCH_HALT' } as KillswitchState),
      readTenant: (tid: string | null) =>
        tid && state.tenants?.[tid] ? state.tenants[tid]! : null,
    };
  }

  it('tenant HALT beats platform DEGRADED', () => {
    const p = port({
      platform: { level: 'degraded', reasonCode: 'KILLSWITCH_HALT' },
      tenants: {
        t_alpha: { level: 'halt', reasonCode: 'TENANT_PORTAL_COMPROMISED' },
      },
    });
    expect(resolveKillswitch(p, 't_alpha').level).toBe('halt');
    expect(resolveKillswitch(p, 't_alpha').reasonCode).toBe('TENANT_PORTAL_COMPROMISED');
  });

  it('platform HALT applies to a tenant with no override', () => {
    const p = port({
      platform: { level: 'halt', reasonCode: 'PROVIDER_INCIDENT' },
    });
    expect(resolveKillswitch(p, 't_alpha').level).toBe('halt');
    expect(resolveKillswitch(p, 't_alpha').reasonCode).toBe('PROVIDER_INCIDENT');
  });

  it('tenant DEGRADED wins over platform DEGRADED', () => {
    const p = port({
      platform: { level: 'degraded', reasonCode: 'KILLSWITCH_HALT' },
      tenants: {
        t_alpha: { level: 'degraded', reasonCode: 'STALE_GROUNDING_FACTS' },
      },
    });
    expect(resolveKillswitch(p, 't_alpha').reasonCode).toBe('STALE_GROUNDING_FACTS');
  });

  it('returns LIVE when nothing is configured', () => {
    const p = port({});
    expect(resolveKillswitch(p, 't_alpha').level).toBe('live');
  });
});

describe('renderKillswitchRefusalText', () => {
  it('returns user-facing copy without leaking the reason code', () => {
    const text = renderKillswitchRefusalText({
      level: 'halt',
      reasonCode: 'TENANT_DATA_LEAK_SUSPECTED',
    });
    expect(text).toMatch(/temporarily paused/i);
    expect(text).not.toMatch(/TENANT_DATA_LEAK/);
    expect(text).not.toMatch(/reason/i);
  });

  it('returns empty string for LIVE / DEGRADED', () => {
    expect(
      renderKillswitchRefusalText({ level: 'live', reasonCode: 'KILLSWITCH_HALT' }),
    ).toBe('');
    expect(
      renderKillswitchRefusalText({ level: 'degraded', reasonCode: 'KILLSWITCH_HALT' }),
    ).toBe('');
  });
});

describe('kernel.think() — killswitch short-circuit', () => {
  it('refuses immediately on platform HALT without calling the sensor', async () => {
    const counted = scriptedSensor();
    const port = createEnvKillswitchPort({ KILLSWITCH_STATE: 'halt' });
    const kernel = createBrainKernel({
      sensors: [counted.sensor],
      killswitch: port,
    });
    const decision = await kernel.think(makeRequest());
    expect(decision.kind).toBe('refusal');
    expect(counted.calls).toBe(0);
  });

  it('refuses immediately on tenant HALT (per-tenant scope)', async () => {
    const counted = scriptedSensor();
    const port = createEnvKillswitchPort({
      KILLSWITCH_TENANT_t_alpha: 'halt',
      KILLSWITCH_TENANT_t_alpha_REASON: 'TENANT_DATA_LEAK_SUSPECTED',
    });
    const kernel = createBrainKernel({
      sensors: [counted.sensor],
      killswitch: port,
    });
    const decision = await kernel.think(makeRequest());
    expect(decision.kind).toBe('refusal');
    expect(counted.calls).toBe(0);
  });

  it('proceeds on DEGRADED (non-fatal)', async () => {
    const counted = scriptedSensor();
    const port = createEnvKillswitchPort({ KILLSWITCH_STATE: 'degraded' });
    const kernel = createBrainKernel({
      sensors: [counted.sensor],
      killswitch: port,
    });
    const decision = await kernel.think(makeRequest());
    expect(decision.kind).not.toBe('refusal');
    expect(counted.calls).toBe(1);
  });

  it('does not halt a different tenant on a tenant-scoped HALT', async () => {
    const counted = scriptedSensor();
    const port = createEnvKillswitchPort({
      KILLSWITCH_TENANT_t_other: 'halt',
    });
    const kernel = createBrainKernel({
      sensors: [counted.sensor],
      killswitch: port,
    });
    const decision = await kernel.think(makeRequest()); // scope tenant is t_alpha
    expect(decision.kind).not.toBe('refusal');
    expect(counted.calls).toBe(1);
  });
});

describe('kernel.thinkStream() — killswitch short-circuit', () => {
  it('emits turn_start + gate_verdict + done(refusal) on HALT with no text deltas', async () => {
    const sensorCallStream = vi.fn();
    const counted: Sensor = {
      id: 'fake',
      modelId: 'fake-model',
      priority: 1,
      capabilities: ['fast'],
      async call() {
        return {
          text: 'should not be called',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'fake-model',
          sensorId: 'fake',
        };
      },
      callStream: sensorCallStream as never,
    };
    const port = createEnvKillswitchPort({ KILLSWITCH_STATE: 'halt' });
    const kernel = createBrainKernel({
      sensors: [counted],
      killswitch: port,
    });
    const events: Array<string> = [];
    for await (const ev of kernel.thinkStream(makeRequest())) {
      events.push(ev.kind);
    }
    expect(events).toEqual(['turn_start', 'gate_verdict', 'done']);
    expect(sensorCallStream).not.toHaveBeenCalled();
  });
});
