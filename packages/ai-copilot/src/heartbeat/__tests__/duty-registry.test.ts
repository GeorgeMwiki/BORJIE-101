/**
 * Heartbeat duty-registry tests — Wave 27 (Part B.8 amplification).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildHeartbeatDutyRegistry,
  createHeartbeatEngine,
  FAST_CADENCE_MS,
  HEARTBEAT_DUTY_IDS,
  MEDIUM_CADENCE_MS,
  SLOW_CADENCE_MS,
  type DutyWorker,
} from '../index.js';

function okWorker(): DutyWorker {
  return async () => {};
}

describe('heartbeat duty-registry', () => {
  it('exposes 23 duty ids', () => {
    expect(Object.keys(HEARTBEAT_DUTY_IDS).length).toBe(23);
  });

  it('returns only duties whose workers were provided', () => {
    const registry = buildHeartbeatDutyRegistry({
      workers: {
        arrearsProactiveScan: okWorker(),
        vendorSlaWatchdog: okWorker(),
      },
    });
    expect(registry).toHaveLength(2);
    expect(registry.map((d) => d.id)).toEqual([
      HEARTBEAT_DUTY_IDS.arrearsProactiveScan,
      HEARTBEAT_DUTY_IDS.vendorSlaWatchdog,
    ]);
  });

  it('assigns the correct cadence to each duty (sample checks)', () => {
    const registry = buildHeartbeatDutyRegistry({
      workers: {
        arrearsProactiveScan: okWorker(), // slow
        vendorSlaWatchdog: okWorker(), // medium
        anomalyDetector: okWorker(), // fast
        tenantPresenceReengagement: okWorker(), // fast
        costLedgerBurnRate: okWorker(), // medium
      },
    });
    const map = Object.fromEntries(registry.map((d) => [d.id, d.cadence]));
    expect(map[HEARTBEAT_DUTY_IDS.arrearsProactiveScan]).toBe('slow');
    expect(map[HEARTBEAT_DUTY_IDS.vendorSlaWatchdog]).toBe('medium');
    expect(map[HEARTBEAT_DUTY_IDS.anomalyDetector]).toBe('fast');
    expect(map[HEARTBEAT_DUTY_IDS.tenantPresenceReengagement]).toBe('fast');
    expect(map[HEARTBEAT_DUTY_IDS.costLedgerBurnRate]).toBe('medium');
  });

  it('honours the disabled flag to park a duty without removing it', () => {
    const registry = buildHeartbeatDutyRegistry({
      workers: {
        anomalyDetector: okWorker(),
        vendorSlaWatchdog: okWorker(),
      },
      disabled: ['vendorSlaWatchdog'],
    });
    expect(registry.map((d) => d.id)).toEqual([
      HEARTBEAT_DUTY_IDS.anomalyDetector,
    ]);
  });
});

describe('heartbeat-engine with duties', () => {
  it('runs a due duty on the first tick and records telemetry', async () => {
    let now = 1_000_000;
    const worker = vi.fn(async () => {});
    const duties = buildHeartbeatDutyRegistry({
      workers: { anomalyDetector: worker },
    });
    const engine = createHeartbeatEngine({ now: () => now, duties });
    const result = await engine.tick({ activeTenantIds: ['t1'], juniors: [] });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(result.dutiesExecuted).toBe(1);
    expect(result.dutyTelemetry).toHaveLength(1);
    expect(result.dutyTelemetry[0].outcome).toBe('ok');
    expect(result.dutyTelemetry[0].dutyId).toBe(
      HEARTBEAT_DUTY_IDS.anomalyDetector,
    );
  });

  it('skips a duty whose cadence has not elapsed', async () => {
    let now = 1_000_000;
    const worker = vi.fn(async () => {});
    const duties = buildHeartbeatDutyRegistry({
      workers: { vendorSlaWatchdog: worker }, // medium = 60s
    });
    const engine = createHeartbeatEngine({ now: () => now, duties });
    await engine.tick({ activeTenantIds: [], juniors: [] });
    expect(worker).toHaveBeenCalledTimes(1);

    // Next tick 1s later — medium cadence not elapsed
    now += 1_000;
    const result = await engine.tick({ activeTenantIds: [], juniors: [] });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(result.dutyTelemetry[0].outcome).toBe('skipped');

    // Next tick 60s later — cadence elapsed
    now += MEDIUM_CADENCE_MS;
    await engine.tick({ activeTenantIds: [], juniors: [] });
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing duty from its siblings', async () => {
    let now = 1_000_000;
    const good = vi.fn(async () => {});
    const bad = vi.fn(async () => {
      throw new Error('boom');
    });
    const duties = buildHeartbeatDutyRegistry({
      workers: {
        anomalyDetector: bad,
        tenantPresenceReengagement: good,
      },
    });
    const engine = createHeartbeatEngine({ now: () => now, duties });
    const result = await engine.tick({ activeTenantIds: [], juniors: [] });
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(result.dutiesExecuted).toBe(1);
    expect(result.dutiesFailed).toBe(1);
    const badEntry = result.dutyTelemetry.find(
      (d) => d.dutyId === HEARTBEAT_DUTY_IDS.anomalyDetector,
    );
    expect(badEntry?.outcome).toBe('error');
    expect(badEntry?.errorMessage).toContain('boom');
  });

  it('cadence defaults: fast=5s, medium=60s, slow=5min', () => {
    expect(FAST_CADENCE_MS).toBe(5_000);
    expect(MEDIUM_CADENCE_MS).toBe(60_000);
    expect(SLOW_CADENCE_MS).toBe(300_000);
  });
});
