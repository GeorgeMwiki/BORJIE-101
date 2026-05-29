/**
 * Rollout controller — registry-driven version picking + graceful
 * fallback coverage.
 *
 * Uses an in-memory fake of the `RolloutRegistryPort` so we can drive
 * every status transition path without touching the DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createRolloutController,
  type RolloutPromptRow,
  type RolloutRegistryPort,
} from '../rollout-controller.js';
import { logger } from '../../../logger.js';

function makeFakeRegistry(initial: ReadonlyArray<RolloutPromptRow> = []): {
  port: RolloutRegistryPort;
  rows: RolloutPromptRow[];
  failNext: boolean;
} {
  const state = {
    rows: [...initial] as RolloutPromptRow[],
    failNext: false,
  };
  const port: RolloutRegistryPort = {
    async findActive(capability) {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('forced registry failure');
      }
      return (
        state.rows.find(
          (r) => r.capability === capability && r.status === 'active',
        ) ?? null
      );
    },
    async findCanaries(capability) {
      return state.rows.filter(
        (r) =>
          r.capability === capability &&
          (r.status === 'canary' || r.status === 'canary-25'),
      );
    },
  };
  return { port, rows: state.rows, failNext: state.failNext } as ReturnType<
    typeof makeFakeRegistry
  > & { failNext: boolean };
}

describe('createRolloutController', () => {
  // Pino-based logger is the canonical error sink (per CLAUDE.md "No
  // console.log in services — Pino only"). The controller calls
  // `logger.error(...)` on registry failure; the spy intercepts that
  // call so we can assert it fired without bleeding pino output into
  // the test stream.
  let errorSpy = vi.spyOn(logger, 'error');

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  it('returns null when no rows exist for the capability', async () => {
    const reg = makeFakeRegistry();
    const ctl = createRolloutController({ registry: reg.port });
    const decision = await ctl.pickPrompt({ tenantId: 't_1', capability: 'support' });
    expect(decision).toBeNull();
  });

  it('returns the active prompt when no canaries exist', async () => {
    const reg = makeFakeRegistry([
      { capability: 'support', version: 'v1', promptText: 'P1', status: 'active' },
    ]);
    const ctl = createRolloutController({ registry: reg.port });
    const decision = await ctl.pickPrompt({ tenantId: 't_1', capability: 'support' });
    expect(decision?.version).toBe('v1');
    expect(decision?.promptText).toBe('P1');
    expect(decision?.source).toBe('registry');
  });

  it('routes most tenants to active and a 5% slice to canary', async () => {
    const reg = makeFakeRegistry([
      { capability: 'support', version: 'v1', promptText: 'P1', status: 'active' },
      { capability: 'support', version: 'v2', promptText: 'P2', status: 'canary' },
    ]);
    const ctl = createRolloutController({ registry: reg.port });
    const tally: Record<string, number> = {};
    for (let i = 0; i < 500; i += 1) {
      const d = await ctl.pickPrompt({ tenantId: `t_${i}`, capability: 'support' });
      tally[d!.version] = (tally[d!.version] ?? 0) + 1;
    }
    // v1 around 475, v2 around 25 (±lots of variance — assert >=70% on v1).
    expect(tally.v1 ?? 0).toBeGreaterThan(350);
    // v2 should appear at least once across 500 tenants.
    expect(tally.v2 ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('routes a 25% slice to canary-25 when present', async () => {
    const reg = makeFakeRegistry([
      { capability: 'cap', version: 'active', promptText: 'A', status: 'active' },
      { capability: 'cap', version: 'cn25', promptText: 'B', status: 'canary-25' },
    ]);
    const ctl = createRolloutController({ registry: reg.port });
    const tally: Record<string, number> = {};
    for (let i = 0; i < 400; i += 1) {
      const d = await ctl.pickPrompt({ tenantId: `t_${i}`, capability: 'cap' });
      tally[d!.version] = (tally[d!.version] ?? 0) + 1;
    }
    expect(tally.cn25 ?? 0).toBeGreaterThan(60);
    expect(tally.cn25 ?? 0).toBeLessThan(180);
  });

  it('is stable — same tenant repeatedly gets the same version', async () => {
    const reg = makeFakeRegistry([
      { capability: 'cap', version: 'active', promptText: 'A', status: 'active' },
      { capability: 'cap', version: 'cn', promptText: 'B', status: 'canary' },
    ]);
    const ctl = createRolloutController({ registry: reg.port });
    const a = await ctl.pickPrompt({ tenantId: 't_stable', capability: 'cap' });
    const b = await ctl.pickPrompt({ tenantId: 't_stable', capability: 'cap' });
    const c = await ctl.pickPrompt({ tenantId: 't_stable', capability: 'cap' });
    expect(a?.version).toBe(b?.version);
    expect(b?.version).toBe(c?.version);
  });

  it('returns null when registry read throws', async () => {
    const reg = makeFakeRegistry([
      { capability: 'cap', version: 'v1', promptText: 'P', status: 'active' },
    ]);
    (reg as { failNext: boolean }).failNext = true;
    // Manually mutate the closure flag — the fake reads it.
    const port: RolloutRegistryPort = {
      async findActive() {
        throw new Error('boom');
      },
      async findCanaries() {
        return [];
      },
    };
    const ctl = createRolloutController({ registry: port });
    const d = await ctl.pickPrompt({ tenantId: 't_1', capability: 'cap' });
    expect(d).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns null for a capability NOT in the allow-list', async () => {
    const reg = makeFakeRegistry([
      { capability: 'support', version: 'v1', promptText: 'P', status: 'active' },
    ]);
    const ctl = createRolloutController({
      registry: reg.port,
      capabilitiesEnabled: new Set(['other-cap']),
    });
    const d = await ctl.pickPrompt({ tenantId: 't_1', capability: 'support' });
    expect(d).toBeNull();
  });

  it('returns null when args.capability is empty', async () => {
    const reg = makeFakeRegistry();
    const ctl = createRolloutController({ registry: reg.port });
    const d = await ctl.pickPrompt({ tenantId: 't_1', capability: '' });
    expect(d).toBeNull();
  });

  it('handles the no-active-but-has-canary edge case by falling back to a canary version', async () => {
    const reg = makeFakeRegistry([
      { capability: 'cap', version: 'cn-only', promptText: 'C', status: 'canary' },
    ]);
    const ctl = createRolloutController({ registry: reg.port });
    const d = await ctl.pickPrompt({ tenantId: 't_alone', capability: 'cap' });
    expect(d).not.toBeNull();
    expect(d!.version).toBe('cn-only');
  });

  it('honours custom canary fractions', async () => {
    const reg = makeFakeRegistry([
      { capability: 'cap', version: 'active', promptText: 'A', status: 'active' },
      { capability: 'cap', version: 'cn', promptText: 'B', status: 'canary' },
    ]);
    const ctl = createRolloutController({
      registry: reg.port,
      fractions: { canary: 50, canary25: 0 },
    });
    const tally: Record<string, number> = {};
    for (let i = 0; i < 400; i += 1) {
      const d = await ctl.pickPrompt({ tenantId: `t_${i}`, capability: 'cap' });
      tally[d!.version] = (tally[d!.version] ?? 0) + 1;
    }
    // With 50/50 split, both should be substantially populated.
    expect(tally.active ?? 0).toBeGreaterThan(100);
    expect(tally.cn ?? 0).toBeGreaterThan(100);
  });
});
