/**
 * Tests for createConnectorRegistry — pure factory, no I/O.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createConnectorRegistry,
  type ConnectorEntry,
  type ConnectorHealth,
  type ConnectorRegistry,
} from '../registry.js';
import type { BaseConnector, CircuitHealth, ConnectorOutcome } from '../base-connector.js';

function fakeConnector(id: string, circuit?: CircuitHealth): BaseConnector {
  const state: CircuitHealth =
    circuit ?? Object.freeze({ state: 'closed', errorCount: 0, lastErrorAt: null });
  return {
    id,
    call: async <_I, O>() =>
      Object.freeze({ kind: 'ok', data: null as O, latencyMs: 1, attempt: 1 }) as ConnectorOutcome<O>,
    health: () => state,
  };
}

describe('createConnectorRegistry', () => {
  let registry: ConnectorRegistry;
  beforeEach(() => {
    registry = createConnectorRegistry({ clock: () => 1_700_000_000_000 });
  });

  it('registers a connector and returns the frozen entry', () => {
    const entry = registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa B2C',
      connector: fakeConnector('mpesa-b2c'),
    });
    expect(entry.id).toBe('mpesa-b2c');
    expect(entry.kind).toBe('mpesa-b2c');
    expect(entry.health.status).toBe('unknown');
    expect(entry.policy.maxRetryAttempts).toBe(2);
    expect(entry.policy.retryInitialDelayMs).toBe(200);
  });

  it('rejects empty id', () => {
    expect(() =>
      registry.register({
        id: '',
        kind: 'mpesa-b2c',
        displayName: 'M-Pesa',
        connector: fakeConnector('x'),
      }),
    ).toThrow(/id is required/);
  });

  it('rejects duplicate id', () => {
    registry.register({
      id: 'gepg',
      kind: 'gepg',
      displayName: 'GePG',
      connector: fakeConnector('gepg'),
    });
    expect(() =>
      registry.register({
        id: 'gepg',
        kind: 'gepg',
        displayName: 'GePG-2',
        connector: fakeConnector('gepg'),
      }),
    ).toThrow(/already registered/);
  });

  it('list() returns all registered entries', () => {
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa B2C',
      connector: fakeConnector('mpesa-b2c'),
    });
    registry.register({
      id: 'kra-mri',
      kind: 'kra-mri',
      displayName: 'KRA MRI',
      connector: fakeConnector('kra-mri'),
    });
    const all = registry.list();
    expect(all.length).toBe(2);
    expect(all.map((e: ConnectorEntry) => e.id).sort()).toEqual(['kra-mri', 'mpesa-b2c']);
  });

  it('get() returns null for unknown ids', () => {
    expect(registry.get('nope')).toBeNull();
  });

  it('unregister() removes the entry', () => {
    registry.register({
      id: 'opensearch-indexer',
      kind: 'opensearch-indexer',
      displayName: 'OpenSearch',
      connector: fakeConnector('opensearch-indexer'),
    });
    expect(registry.unregister('opensearch-indexer')).toBe(true);
    expect(registry.get('opensearch-indexer')).toBeNull();
  });

  it('setHealth() updates the cached snapshot', () => {
    registry.register({
      id: 'rera-registry',
      kind: 'rera-registry',
      displayName: 'RERA',
      connector: fakeConnector('rera-registry'),
    });
    const next: ConnectorHealth = {
      circuit: { state: 'open', errorCount: 5, lastErrorAt: '2026-05-14T12:00:00.000Z' },
      status: 'unhealthy',
      lastCheckedAt: '2026-05-14T12:00:00.000Z',
      lastError: 'TLS handshake failed',
      probeLatencyMs: 4_500,
    };
    registry.setHealth('rera-registry', next);
    const entry = registry.get('rera-registry');
    expect(entry?.health.status).toBe('unhealthy');
    expect(entry?.health.lastError).toBe('TLS handshake failed');
  });

  it('refreshCircuit() rolls live circuit state into the cache', () => {
    const open: CircuitHealth = { state: 'open', errorCount: 7, lastErrorAt: 'now' };
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector: fakeConnector('mpesa-b2c', open),
    });
    const health = registry.refreshCircuit('mpesa-b2c');
    expect(health?.circuit.state).toBe('open');
    expect(health?.status).toBe('unhealthy');
  });

  it('refreshCircuit() returns null for unknown id', () => {
    expect(registry.refreshCircuit('ghost')).toBeNull();
  });

  it('clear() empties the registry', () => {
    registry.register({
      id: 'gepg',
      kind: 'gepg',
      displayName: 'GePG',
      connector: fakeConnector('gepg'),
    });
    registry.clear();
    expect(registry.list().length).toBe(0);
  });

  it('property-management connector slots include all 5 expected kinds', () => {
    const kinds: Array<{ id: string; kind: 'mpesa-b2c' | 'gepg' | 'kra-mri' | 'rera-registry' | 'opensearch-indexer' }> = [
      { id: 'mpesa-b2c', kind: 'mpesa-b2c' },
      { id: 'gepg', kind: 'gepg' },
      { id: 'kra-mri', kind: 'kra-mri' },
      { id: 'rera-registry', kind: 'rera-registry' },
      { id: 'opensearch-indexer', kind: 'opensearch-indexer' },
    ];
    for (const k of kinds) {
      registry.register({
        ...k,
        displayName: k.id,
        connector: fakeConnector(k.id),
      });
    }
    expect(registry.list().length).toBe(5);
  });
});
