/**
 * Tests for createHealthScheduler — covers probeOnce, start/stop,
 * observability sink, and probe-timeout fallback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createConnectorRegistry, type ConnectorRegistry } from '../registry.js';
import {
  createHealthScheduler,
  type HealthObservabilitySink,
  type HealthProbeResult,
} from '../health-scheduler.js';
import type { BaseConnector, CircuitHealth, ConnectorOutcome } from '../base-connector.js';

function fakeConnector(id: string, circuit?: CircuitHealth): BaseConnector {
  const state: CircuitHealth =
    circuit ?? Object.freeze({ state: 'closed', errorCount: 0, lastErrorAt: null });
  return {
    id,
    health: () => state,
    call: async <_I, O>() =>
      Object.freeze({ kind: 'ok', data: null as O, latencyMs: 1, attempt: 1 }) as ConnectorOutcome<O>,
  };
}

describe('createHealthScheduler', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = createConnectorRegistry({ clock: () => 1_700_000_000_000 });
  });

  it('probeOnce marks healthy when probe returns true', async () => {
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector: fakeConnector('mpesa-b2c'),
      healthProbe: async () => true,
    });
    const scheduler = createHealthScheduler({ registry });
    const results = await scheduler.probeOnce();
    expect(results.length).toBe(1);
    expect(results[0]!.status).toBe('healthy');
    expect(results[0]!.error).toBeNull();
    expect(registry.get('mpesa-b2c')?.health.status).toBe('healthy');
  });

  it('probeOnce marks unhealthy when probe returns false', async () => {
    registry.register({
      id: 'gepg',
      kind: 'gepg',
      displayName: 'GePG',
      connector: fakeConnector('gepg'),
      healthProbe: async () => false,
    });
    const scheduler = createHealthScheduler({ registry });
    const results = await scheduler.probeOnce();
    expect(results[0]!.status).toBe('unhealthy');
    expect(results[0]!.error).toBe('probe returned false');
  });

  it('probeOnce marks unhealthy when probe throws', async () => {
    registry.register({
      id: 'kra-mri',
      kind: 'kra-mri',
      displayName: 'KRA MRI',
      connector: fakeConnector('kra-mri'),
      healthProbe: async () => {
        throw new Error('TLS handshake failed');
      },
    });
    const scheduler = createHealthScheduler({ registry });
    const results = await scheduler.probeOnce();
    expect(results[0]!.status).toBe('unhealthy');
    expect(results[0]!.error).toBe('TLS handshake failed');
  });

  it('probeOnce times out probes that hang', async () => {
    registry.register({
      id: 'rera-registry',
      kind: 'rera-registry',
      displayName: 'RERA',
      connector: fakeConnector('rera-registry'),
      healthProbe: () =>
        new Promise<boolean>(() => {
          /* never resolves */
        }),
    });
    const scheduler = createHealthScheduler({ registry, probeTimeoutMs: 25 });
    const results = await scheduler.probeOnce();
    expect(results[0]!.status).toBe('unhealthy');
    expect(results[0]!.error).toMatch(/timed out/);
  });

  it('probeOnce rolls open circuit into unhealthy even without a probe', async () => {
    registry.register({
      id: 'opensearch-indexer',
      kind: 'opensearch-indexer',
      displayName: 'OpenSearch',
      connector: fakeConnector('opensearch-indexer', {
        state: 'open',
        errorCount: 7,
        lastErrorAt: 'x',
      }),
    });
    const scheduler = createHealthScheduler({ registry });
    const results = await scheduler.probeOnce();
    expect(results[0]!.status).toBe('unhealthy');
    expect(registry.get('opensearch-indexer')?.health.status).toBe('unhealthy');
  });

  it('observability sink receives every probe result', async () => {
    const seen: HealthProbeResult[] = [];
    const sink: HealthObservabilitySink = {
      recordProbe: (result: HealthProbeResult) => seen.push(result),
    };
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector: fakeConnector('mpesa-b2c'),
      healthProbe: async () => true,
    });
    registry.register({
      id: 'gepg',
      kind: 'gepg',
      displayName: 'GePG',
      connector: fakeConnector('gepg'),
      healthProbe: async () => false,
    });
    const scheduler = createHealthScheduler({ registry, observability: sink });
    await scheduler.probeOnce();
    expect(seen.length).toBe(2);
    expect(new Set(seen.map((r: HealthProbeResult) => r.connectorId))).toEqual(
      new Set(['mpesa-b2c', 'gepg']),
    );
  });

  it('start / stop manage the underlying interval handle', () => {
    let intervalCallback: (() => void) | null = null;
    let cleared = false;
    const scheduler = createHealthScheduler({
      registry,
      intervalMs: 1000,
      setInterval: (cb: () => void) => {
        intervalCallback = cb;
        return Symbol('handle');
      },
      clearInterval: () => {
        cleared = true;
      },
    });
    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    expect(intervalCallback).not.toBeNull();
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    expect(cleared).toBe(true);
  });

  it('start is idempotent', () => {
    let intervalCount = 0;
    const scheduler = createHealthScheduler({
      registry,
      intervalMs: 1000,
      setInterval: () => {
        intervalCount += 1;
        return Symbol('handle');
      },
      clearInterval: () => undefined,
    });
    scheduler.start();
    scheduler.start();
    expect(intervalCount).toBe(1);
  });

  it('sink errors do not break the scheduler', async () => {
    const throwingSink: HealthObservabilitySink = {
      recordProbe: () => {
        throw new Error('sink down');
      },
    };
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector: fakeConnector('mpesa-b2c'),
      healthProbe: async () => true,
    });
    const scheduler = createHealthScheduler({ registry, observability: throwingSink });
    await expect(scheduler.probeOnce()).resolves.toBeDefined();
  });
});
