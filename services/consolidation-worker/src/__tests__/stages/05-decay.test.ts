/**
 * Stage 05 — decay unit tests.
 *
 * Coverage:
 *   1. no semantic port wired → skipped + zero report
 *   2. per-tenant decay is invoked once per unique tenant
 *   3. failure on one tenant doesn't block the others
 *   4. respects decayPerDay override
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_DECAY_PER_DAY, runDecayStage } from '../../stages/05-decay.js';
import type { SemanticDecayPort, StageLogger } from '../../stages/types.js';

function makeLogger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePort(opts: {
  failFor?: string;
} = {}): {
  port: SemanticDecayPort;
  calls: Array<{ tenantId: string | null; decayPerDay: number }>;
} {
  const calls: Array<{ tenantId: string | null; decayPerDay: number }> = [];
  const port: SemanticDecayPort = {
    async decay(args) {
      calls.push({ tenantId: args.tenantId, decayPerDay: args.decayPerDay });
      if (opts.failFor !== undefined && args.tenantId === opts.failFor) {
        throw new Error('decay boom');
      }
      return 5;
    },
  };
  return { port, calls };
}

describe('runDecayStage', () => {
  it('is a no-op when no semantic port is wired', async () => {
    const out = await runDecayStage({
      tenantIds: ['t-1', 't-2'],
      logger: makeLogger(),
    });
    expect(out.factsDecayed).toBe(0);
    expect(Object.keys(out.perTenant)).toHaveLength(0);
  });

  it('invokes decay once per unique tenant', async () => {
    const { port, calls } = makePort();
    const out = await runDecayStage({
      tenantIds: ['t-1', 't-1', 't-2', null, null],
      semantic: port,
      logger: makeLogger(),
    });
    // 3 unique tenants: t-1, t-2, null
    expect(calls).toHaveLength(3);
    expect(out.factsDecayed).toBe(15); // 3 * 5
  });

  it('continues after a tenant fails', async () => {
    const { port, calls } = makePort({ failFor: 't-bad' });
    const out = await runDecayStage({
      tenantIds: ['t-bad', 't-good'],
      semantic: port,
      logger: makeLogger(),
    });
    expect(calls).toHaveLength(2);
    expect(out.factsDecayed).toBe(5); // only t-good succeeded
    expect(out.perTenant['t-good']).toBe(5);
  });

  it('uses default decayPerDay when not specified', async () => {
    const { port, calls } = makePort();
    await runDecayStage({
      tenantIds: ['t-1'],
      semantic: port,
      logger: makeLogger(),
    });
    expect(calls[0]?.decayPerDay).toBe(DEFAULT_DECAY_PER_DAY);
  });

  it('forwards a custom decayPerDay', async () => {
    const { port, calls } = makePort();
    await runDecayStage({
      tenantIds: ['t-1'],
      semantic: port,
      logger: makeLogger(),
      decayPerDay: 0.9,
    });
    expect(calls[0]?.decayPerDay).toBe(0.9);
  });
});
