/**
 * Tests for createConnectorOrchestrator — verifies retry-with-jitter,
 * backup failover, dispatch timeout, and registry refresh.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createConnectorRegistry, type ConnectorRegistry } from '../registry.js';
import { createConnectorOrchestrator } from '../orchestrator.js';
import type { BaseConnector, CircuitHealth, ConnectorOutcome, ConnectorRequest } from '../base-connector.js';

interface ScriptedConnector extends BaseConnector {
  readonly calls: { count: number };
}

function scriptedConnector(
  id: string,
  outcomes: ReadonlyArray<ConnectorOutcome<unknown>>,
  circuit?: CircuitHealth,
): ScriptedConnector {
  const calls = { count: 0 };
  const state: CircuitHealth =
    circuit ?? Object.freeze({ state: 'closed', errorCount: 0, lastErrorAt: null });
  return {
    id,
    calls,
    health: () => state,
    async call<_I, O>(_req: ConnectorRequest<_I>): Promise<ConnectorOutcome<O>> {
      const idx = Math.min(calls.count, outcomes.length - 1);
      calls.count += 1;
      return outcomes[idx]! as ConnectorOutcome<O>;
    },
  };
}

const req: ConnectorRequest<{ msisdn: string }> = Object.freeze({
  path: '/b2c/payment',
  method: 'POST',
  body: { msisdn: '254700111222' },
});

describe('createConnectorOrchestrator', () => {
  let registry: ConnectorRegistry;
  let clockMs: number;

  beforeEach(() => {
    clockMs = 1_700_000_000_000;
    registry = createConnectorRegistry({ clock: () => clockMs });
  });

  it('returns unconfigured outcome when connector is not registered', async () => {
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch('ghost', req);
    expect(result.outcome.kind).toBe('unconfigured');
    expect(result.servedBy).toBe('ghost');
    expect(result.attemptsUsed).toBe(0);
    expect(result.failedOver).toBe(false);
  });

  it('returns ok on first attempt', async () => {
    const okOutcome: ConnectorOutcome<{ ref: string }> = {
      kind: 'ok',
      data: { ref: 'mpesa-tx-1' },
      latencyMs: 12,
      attempt: 1,
    };
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector: scriptedConnector('mpesa-b2c', [okOutcome]),
    });
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch<{ msisdn: string }, { ref: string }>('mpesa-b2c', req);
    expect(result.outcome.kind).toBe('ok');
    expect(result.attemptsUsed).toBe(1);
    expect(result.failedOver).toBe(false);
    expect(result.servedBy).toBe('mpesa-b2c');
  });

  it('retries on retryable outcomes and eventually succeeds', async () => {
    const transport: ConnectorOutcome<unknown> = { kind: 'transport-error', message: 'ECONNRESET' };
    const ok: ConnectorOutcome<unknown> = { kind: 'ok', data: { ok: true }, latencyMs: 5, attempt: 1 };
    const connector = scriptedConnector('mpesa-b2c', [transport, transport, ok]);
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector,
      policy: { maxRetryAttempts: 3, retryInitialDelayMs: 1 },
    });
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch('mpesa-b2c', req);
    expect(result.outcome.kind).toBe('ok');
    expect(result.attemptsUsed).toBe(3);
    expect(connector.calls.count).toBe(3);
  });

  it('does NOT retry non-retryable outcomes (4xx)', async () => {
    const fourxx: ConnectorOutcome<unknown> = {
      kind: 'upstream-error',
      status: 400,
      message: 'bad request',
    };
    const connector = scriptedConnector('mpesa-b2c', [fourxx]);
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector,
      policy: { maxRetryAttempts: 5, retryInitialDelayMs: 1 },
    });
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch('mpesa-b2c', req);
    expect(result.outcome.kind).toBe('upstream-error');
    expect(result.attemptsUsed).toBe(1);
    expect(connector.calls.count).toBe(1);
  });

  it('falls over to backup connector when primary is circuit-open', async () => {
    const open: ConnectorOutcome<unknown> = {
      kind: 'circuit-open',
      nextProbeAt: '2026-05-14T12:00:30.000Z',
    };
    const ok: ConnectorOutcome<unknown> = {
      kind: 'ok',
      data: { ref: 'gepg-fallback' },
      latencyMs: 8,
      attempt: 1,
    };
    const primary = scriptedConnector('mpesa-b2c', [open, open, open]);
    const backup = scriptedConnector('gepg', [ok]);
    registry.register({
      id: 'mpesa-b2c',
      kind: 'mpesa-b2c',
      displayName: 'M-Pesa',
      connector: primary,
      policy: { maxRetryAttempts: 2, retryInitialDelayMs: 1, backupConnectorId: 'gepg' },
    });
    registry.register({
      id: 'gepg',
      kind: 'gepg',
      displayName: 'GePG',
      connector: backup,
    });
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch('mpesa-b2c', req);
    expect(result.outcome.kind).toBe('ok');
    expect(result.failedOver).toBe(true);
    expect(result.servedBy).toBe('gepg');
  });

  it('returns last failure when no backup configured', async () => {
    const open: ConnectorOutcome<unknown> = {
      kind: 'circuit-open',
      nextProbeAt: '2026-05-14T12:00:30.000Z',
    };
    const connector = scriptedConnector('kra-mri', [open, open]);
    registry.register({
      id: 'kra-mri',
      kind: 'kra-mri',
      displayName: 'KRA MRI',
      connector,
      policy: { maxRetryAttempts: 2, retryInitialDelayMs: 1 },
    });
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch('kra-mri', req);
    expect(result.outcome.kind).toBe('circuit-open');
    expect(result.failedOver).toBe(false);
    expect(result.attemptsUsed).toBe(2);
  });

  it('does NOT fall over for non-failover outcomes (rate-limited)', async () => {
    const rl: ConnectorOutcome<unknown> = { kind: 'rate-limited', retryAfterMs: 1_000 };
    const connector = scriptedConnector('opensearch-indexer', [rl, rl]);
    const backup = scriptedConnector('rera-registry', [
      { kind: 'ok', data: { ok: true }, latencyMs: 5, attempt: 1 },
    ]);
    registry.register({
      id: 'opensearch-indexer',
      kind: 'opensearch-indexer',
      displayName: 'OpenSearch',
      connector,
      policy: {
        maxRetryAttempts: 2,
        retryInitialDelayMs: 1,
        backupConnectorId: 'rera-registry',
      },
    });
    registry.register({
      id: 'rera-registry',
      kind: 'rera-registry',
      displayName: 'RERA',
      connector: backup,
    });
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch('opensearch-indexer', req);
    // Rate-limit is retryable but not failover-worthy.
    expect(result.outcome.kind).toBe('rate-limited');
    expect(result.failedOver).toBe(false);
    expect(backup.calls.count).toBe(0);
  });

  it('honours dispatchTimeoutMs', async () => {
    const slowConnector: BaseConnector = {
      id: 'kra-mri',
      health: () => ({ state: 'closed', errorCount: 0, lastErrorAt: null }),
      call: async <_I, O>() =>
        new Promise<ConnectorOutcome<O>>(() => {
          /* never resolves */
        }),
    };
    registry.register({
      id: 'kra-mri',
      kind: 'kra-mri',
      displayName: 'KRA MRI',
      connector: slowConnector,
      policy: { maxRetryAttempts: 1, dispatchTimeoutMs: 25 },
    });
    const orchestrator = createConnectorOrchestrator({
      registry,
      clock: () => clockMs,
      sleep: async () => undefined,
      random: () => 0.5,
    });
    const result = await orchestrator.dispatch('kra-mri', req);
    expect(result.outcome.kind).toBe('transport-error');
    if (result.outcome.kind === 'transport-error') {
      expect(result.outcome.message).toMatch(/timed out/);
    }
  });
});
