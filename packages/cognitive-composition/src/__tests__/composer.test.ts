/**
 * Unit tests for the composer + wire-health-probe.
 *
 * These cover the pure helpers, the probe table shape, status classification,
 * and the failover/error paths in isolation. End-to-end pipeline behaviour
 * lives in `./integration/*.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createCognitiveComposition, __testables } from '../composer.js';
import {
  buildDefaultProbes,
  evaluateProbeOutcome,
  raceWithTimeout,
  rollupOverall,
  runWireHealth,
} from '../wire-health-probe.js';
import {
  PROBE_DEGRADED_LATENCY_MS,
  PROBE_TIMEOUT_MS,
  WIRE_NAMES,
  type WireHealth,
} from '../types.js';
import { buildDeps } from './fixtures.js';

describe('@borjie/cognitive-composition (unit)', () => {
  it('exposes exactly 12 canonical wire names', () => {
    expect(WIRE_NAMES.length).toBe(12);
    // Spot-check both ends to catch accidental reordering.
    expect(WIRE_NAMES[0]).toBe('cognitive-engine.inference');
    expect(WIRE_NAMES[11]).toBe('brain-llm-router.cascade');
  });

  it('buildDefaultProbes returns exactly 12 bindings in canonical order', () => {
    const { deps } = buildDeps();
    const bindings = buildDefaultProbes(deps);
    expect(bindings.length).toBe(12);
    expect(bindings.map((b) => b.wireName)).toEqual([...WIRE_NAMES]);
  });

  it('evaluateProbeOutcome classifies ok < 800ms as ok and > 800ms as degraded', () => {
    const probedAt = '2026-05-27T00:00:00.000Z';
    const fastOk = evaluateProbeOutcome(
      'cognitive-engine.inference',
      { kind: 'ok', value: 'fine', elapsedMs: 50 },
      probedAt,
    );
    expect(fastOk.status).toBe('ok');

    const slowOk = evaluateProbeOutcome(
      'cognitive-engine.inference',
      { kind: 'ok', value: 'fine', elapsedMs: PROBE_DEGRADED_LATENCY_MS + 1 },
      probedAt,
    );
    expect(slowOk.status).toBe('degraded');
  });

  it('evaluateProbeOutcome marks timeout and error as down with lastError', () => {
    const probedAt = '2026-05-27T00:00:00.000Z';
    const timedOut = evaluateProbeOutcome(
      'cognitive-engine.inference',
      { kind: 'timeout', elapsedMs: PROBE_TIMEOUT_MS },
      probedAt,
    );
    expect(timedOut.status).toBe('down');
    expect(timedOut.lastError).toContain('timeout');

    const errored = evaluateProbeOutcome(
      'cognitive-engine.inference',
      { kind: 'error', error: new Error('nope'), elapsedMs: 12 },
      probedAt,
    );
    expect(errored.status).toBe('down');
    expect(errored.lastError).toBe('nope');
  });

  it('rollupOverall: down dominates degraded dominates ok', () => {
    const make = (status: WireHealth['status']): WireHealth => ({
      wireName: 'cognitive-engine.inference',
      status,
      latencyMs: 0,
      probedAt: '2026-05-27T00:00:00.000Z',
    });
    expect(rollupOverall([make('ok'), make('ok')])).toBe('ok');
    expect(rollupOverall([make('ok'), make('degraded')])).toBe('degraded');
    expect(rollupOverall([make('ok'), make('down'), make('degraded')])).toBe(
      'down',
    );
  });

  it('raceWithTimeout returns timeout when probe is too slow', async () => {
    const outcome = await raceWithTimeout(
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)),
      50,
    );
    expect(outcome.kind).toBe('timeout');
  });

  it('raceWithTimeout surfaces probe errors as kind="error"', async () => {
    const outcome = await raceWithTimeout(async () => {
      throw new Error('boom');
    }, 500);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.error.message).toBe('boom');
    }
  });

  it('runWireHealth persists every probe to the health store', async () => {
    const { deps, healthStore } = buildDeps();
    const report = await runWireHealth({ tenantId: 'tenant-A', deps });

    expect(report.wires.length).toBe(12);
    expect(report.overall).toBe('ok');

    const rows = healthStore.listAll();
    expect(rows.length).toBe(12);
    rows.forEach((row) => {
      expect(row.tenantId).toBe('tenant-A');
      expect(WIRE_NAMES).toContain(row.wireName);
      expect(['ok', 'degraded', 'down']).toContain(row.status);
    });
  });

  it('createCognitiveComposition exposes compose + wireHealth', () => {
    const { deps } = buildDeps();
    const composition = createCognitiveComposition(deps);
    expect(typeof composition.compose).toBe('function');
    expect(typeof composition.wireHealth).toBe('function');
  });

  it('labelConfidence maps the four canonical bands', () => {
    const { labelConfidence } = __testables;
    expect(labelConfidence(0.9)).toBe('high');
    expect(labelConfidence(0.65)).toBe('medium');
    expect(labelConfidence(0.3)).toBe('low');
    expect(labelConfidence(0.1)).toBe('refused');
  });

  it('recallWithFailover throws MemoryTierFailureError when every tier fails', async () => {
    const { deps } = buildDeps({
      memory: {
        episodic: { fail: true },
        semantic: { fail: true },
        procedural: { fail: true },
        reflective: { fail: true },
      },
    });
    await expect(
      __testables.recallWithFailover('tenant-A', 'query', [
        deps.memoryTiers.episodic,
        deps.memoryTiers.semantic,
        deps.memoryTiers.procedural,
        deps.memoryTiers.reflective,
      ]),
    ).rejects.toThrowError(/every memory tier failed/);
  });
});
