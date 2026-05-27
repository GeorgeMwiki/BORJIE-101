/**
 * End-to-end integration tests for `@borjie/cognitive-composition`.
 *
 * Six flows, each a `describe` block — kept in one file so vitest spins up
 * the worker once and the 12-wire probe runs ~70× without paying ts-loader
 * startup per scenario.
 *
 *   1. Full compose pipeline happy path  → output has provenance + confidence
 *   2. Wire-down propagation             → degraded output / WireDownError on critical
 *   3. Memory tier failover              → episodic down ⇒ semantic-only fallback
 *   4. Calibration drift trigger         → high drift ⇒ CalibrationDriftError
 *   5. Tenant isolation                  → tenant A cannot read tenant B's health
 *   6. Audit hash chain integrity        → tampered chain is rejected
 */

import { describe, expect, it } from 'vitest';
import { createCognitiveComposition } from '../../composer.js';
import {
  CalibrationDriftError,
  CognitiveOutputSchema,
  TenantIsolationViolationError,
  WireDownError,
  WIRE_NAMES,
  type CognitiveInput,
  type WireName,
} from '../../types.js';
import { buildDeps } from '../fixtures.js';

const INPUT: CognitiveInput = {
  tenantId: 'tenant-A',
  turnId: 'turn-0001',
  userMessage: 'Audit yesterday’s blast-shift compliance.',
};

// ============================================================================
// 1. Full compose pipeline happy path
// ============================================================================

describe('integration #1: full compose pipeline (happy path)', () => {
  it('produces a fully-formed CognitiveOutput with provenance + confidence', async () => {
    const { deps, auditPort, healthStore } = buildDeps();
    const composition = createCognitiveComposition(deps);

    const output = await composition.compose(INPUT);

    // Shape: passes the public Zod schema (the api-gateway boundary check).
    expect(() => CognitiveOutputSchema.parse(output)).not.toThrow();

    expect(output.tenantId).toBe('tenant-A');
    expect(output.turnId).toBe('turn-0001');
    expect(output.text).toContain('router(');
    expect(output.confidence).toBeGreaterThan(0);
    expect(output.confidence).toBeLessThanOrEqual(1);
    expect(output.confidenceLabel).toBe('high');
    expect(output.wireStatus).toBe('ok');

    // Provenance — one row per contributing wire; at minimum the canonical
    // pipeline contributes 8 wires (4 memory tiers may collapse to 1 if
    // episodic returns hits — which our fixtures do).
    expect(output.provenance.length).toBeGreaterThanOrEqual(8);
    output.provenance.forEach((entry) => {
      expect(WIRE_NAMES).toContain(entry.wireName);
      expect(entry.rowHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
    });

    // Audit chain grew by exactly the provenance length.
    expect(auditPort.chain.length).toBe(output.provenance.length);

    // wireHealth() probed all 12 wires and persisted them.
    const platformRows = healthStore.listAll();
    expect(platformRows.length).toBe(12);
  });
});

// ============================================================================
// 2. Wire-down propagation
// ============================================================================

describe('integration #2: wire-down propagation', () => {
  it('throws WireDownError when a critical wire is down', async () => {
    // Inference is one of the default critical wires.
    const { deps } = buildDeps({ inference: { fail: true } });
    const composition = createCognitiveComposition(deps);

    await expect(composition.compose(INPUT)).rejects.toThrow(WireDownError);

    try {
      await composition.compose(INPUT);
    } catch (err) {
      expect(err).toBeInstanceOf(WireDownError);
      expect((err as WireDownError).code).toBe('wire_down');
      expect((err as WireDownError).wireName).toBe(
        'cognitive-engine.inference',
      );
    }
  });

  it('compose still succeeds (degraded) when a non-critical wire is down', async () => {
    // CoT is NOT in the default critical-set — pipeline must tolerate it.
    // We DO mark it as down via the probe but compose() also runs cot.cot();
    // for this test we keep cot.cot working but flip its probe.
    // Simulate: probe broken but cot itself runs. Easiest path is to keep
    // every wire healthy but probe-slow the kernel into degraded.
    const { deps, healthStore } = buildDeps({
      kernel: undefined,
      // Force a degraded probe on calibration via 850ms slow probe
      // We can't easily slow the probe via the fixture; instead exercise
      // the broader "non-critical down" path by injecting a probe that throws.
      // Subclass the kernel port to throw on probe only.
    });

    // Replace just the kernel probe to throw — kernel is NOT critical.
    const kernel = {
      ...deps.kernel,
      probe: async () => {
        throw new Error('kernel probe nonfatal');
      },
    };
    const patchedDeps = { ...deps, kernel };
    const composition = createCognitiveComposition(patchedDeps);

    // The compose call still has to succeed because kernel itself works,
    // even though the probe is down. The pipeline only fails-fast on
    // CRITICAL wires.
    const output = await composition.compose(INPUT);
    expect(output.tenantId).toBe('tenant-A');

    // The persisted row for the kernel wire MUST be down.
    const rows = await healthStore.list('tenant-A');
    const kernelRow = rows.find(
      (r) => r.wireName === 'central-intelligence.kernel',
    );
    expect(kernelRow?.status).toBe('down');
    expect(kernelRow?.lastError).toBe('kernel probe nonfatal');
  });
});

// ============================================================================
// 3. Memory tier failover
// ============================================================================

describe('integration #3: memory tier failover', () => {
  it('falls back to semantic when episodic is down', async () => {
    const { deps } = buildDeps({
      memory: {
        episodic: { fail: true },
        // semantic stays healthy
      },
    });
    const composition = createCognitiveComposition(deps);

    const output = await composition.compose(INPUT);

    // Failover signal: episodic NOT in tiersUsed; semantic IS.
    expect(output.memoryTiersUsed).not.toContain('episodic');
    expect(output.memoryTiersUsed).toContain('semantic');

    // Provenance includes exactly the tiers we used.
    const memoryWires = output.provenance
      .map((p) => p.wireName)
      .filter((w) => w.startsWith('cognitive-memory.'));
    expect(memoryWires).toContain('cognitive-memory.semantic');
    expect(memoryWires).not.toContain('cognitive-memory.episodic');
  });

  it('cascades through procedural + reflective when both upper tiers are empty', async () => {
    const { deps } = buildDeps({
      memory: {
        episodic: { empty: true },
        semantic: { empty: true },
        procedural: { empty: true },
        // reflective stays healthy
      },
    });
    const composition = createCognitiveComposition(deps);

    const output = await composition.compose(INPUT);

    // Per failover rules, every tier WAS consulted; only the last one
    // produced hits. We document the cascade by asserting reflective is
    // present in the trail.
    expect(output.memoryTiersUsed).toContain('reflective');
  });
});

// ============================================================================
// 4. Calibration drift trigger
// ============================================================================

describe('integration #4: calibration drift trigger', () => {
  it('throws CalibrationDriftError when drift exceeds the threshold', async () => {
    const { deps } = buildDeps({
      calibration: { driftScore: 0.95 },
      driftThreshold: 0.5,
    });
    const composition = createCognitiveComposition(deps);

    await expect(composition.compose(INPUT)).rejects.toThrow(
      CalibrationDriftError,
    );

    try {
      await composition.compose(INPUT);
    } catch (err) {
      expect(err).toBeInstanceOf(CalibrationDriftError);
      expect((err as CalibrationDriftError).code).toBe('calibration_drift');
      expect((err as CalibrationDriftError).threshold).toBe(0.5);
    }
  });

  it('does NOT throw when drift is below the threshold', async () => {
    const { deps } = buildDeps({
      calibration: { driftScore: 0.1 },
      driftThreshold: 0.5,
    });
    const composition = createCognitiveComposition(deps);
    await expect(composition.compose(INPUT)).resolves.toMatchObject({
      tenantId: 'tenant-A',
    });
  });
});

// ============================================================================
// 5. Tenant isolation (health-store boundary check)
// ============================================================================

describe('integration #5: tenant isolation', () => {
  it('tenant A cannot read tenant B health rows via the store API', async () => {
    const { deps, healthStore } = buildDeps();

    // Persist a row under each tenant via two independent probe runs.
    await deps.healthStore.upsert({
      tenantId: 'tenant-A',
      wireName: 'cognitive-engine.inference',
      status: 'ok',
      latencyMs: 12,
      probedAt: '2026-05-27T00:00:00.000Z',
    });
    await deps.healthStore.upsert({
      tenantId: 'tenant-B',
      wireName: 'cognitive-engine.inference',
      status: 'ok',
      latencyMs: 15,
      probedAt: '2026-05-27T00:00:00.000Z',
    });

    const tenantARows = await healthStore.list('tenant-A');
    const tenantBRows = await healthStore.list('tenant-B');

    expect(tenantARows.length).toBe(1);
    expect(tenantBRows.length).toBe(1);
    expect(tenantARows[0]!.tenantId).toBe('tenant-A');
    expect(tenantBRows[0]!.tenantId).toBe('tenant-B');

    // Cross-tenant query yields zero rows — the store boundary enforces
    // exactly the same invariant as the SQL RLS policy.
    const cross = (await healthStore.list('tenant-A')).filter(
      (r) => r.tenantId === 'tenant-B',
    );
    expect(cross.length).toBe(0);
  });

  it('TenantIsolationViolationError carries enough context for the audit log', () => {
    const err = new TenantIsolationViolationError('tenant-B', 'tenant-A');
    expect(err.code).toBe('tenant_isolation_violation');
    expect(err.attemptedTenant).toBe('tenant-B');
    expect(err.callingTenant).toBe('tenant-A');
  });
});

// ============================================================================
// 6. Audit hash chain integrity
// ============================================================================

describe('integration #6: audit hash chain integrity', () => {
  it('chain.verify accepts an untampered chain', async () => {
    const { deps, auditPort } = buildDeps();
    const composition = createCognitiveComposition(deps);
    await composition.compose(INPUT);

    const result = await auditPort.verify(
      auditPort.chain.map((e) => ({
        prevHash: e.prevHash,
        rowHash: e.rowHash,
        payload: e.payload,
      })),
    );
    expect(result.ok).toBe(true);
  });

  it('chain.verify rejects when a row is tampered with', async () => {
    const { deps, auditPort } = buildDeps();
    const composition = createCognitiveComposition(deps);
    await composition.compose(INPUT);

    // Tamper at a deterministic index — the substrate.compile receipt.
    auditPort.tamper(0);

    const result = await auditPort.verify(
      auditPort.chain.map((e) => ({
        prevHash: e.prevHash,
        rowHash: e.rowHash,
        payload: e.payload,
      })),
    );
    expect(result.ok).toBe(false);
    expect(result.firstBrokenIndex).toBe(0);
  });
});
