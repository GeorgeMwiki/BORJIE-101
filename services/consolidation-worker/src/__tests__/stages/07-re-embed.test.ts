/**
 * Stage 07 — re-embed unit tests.
 *
 * Coverage:
 *   1. no re-embedder wired → zero report
 *   2. invoked once per unique tenant with default limit
 *   3. respects perTenantLimit override
 *   4. tenant failure does not stop others
 *   5. forwards modelCutoff to the port
 *   6. handles a global tenant (tenantId === null)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runReEmbedStage,
  type ReEmbedPort,
} from '../../stages/07-re-embed.js';
import type { StageLogger } from '../../stages/types.js';

function makeLogger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePort(opts: { failFor?: string } = {}): {
  port: ReEmbedPort;
  calls: Array<{
    tenantId: string | null;
    limit: number;
    modelCutoff?: Date | string;
  }>;
} {
  const calls: Array<{
    tenantId: string | null;
    limit: number;
    modelCutoff?: Date | string;
  }> = [];
  const port: ReEmbedPort = {
    async reEmbedForTenant(args) {
      const entry: {
        tenantId: string | null;
        limit: number;
        modelCutoff?: Date | string;
      } = { tenantId: args.tenantId, limit: args.limit };
      if (args.modelCutoff !== undefined) entry.modelCutoff = args.modelCutoff;
      calls.push(entry);
      if (opts.failFor !== undefined && args.tenantId === opts.failFor) {
        throw new Error('boom');
      }
      return {
        tenantId: args.tenantId,
        reEmbeddedCount: 7,
        inspectedCount: 20,
      };
    },
  };
  return { port, calls };
}

describe('runReEmbedStage', () => {
  it('is a no-op without a re-embedder', async () => {
    const out = await runReEmbedStage({
      tenantIds: ['t-1'],
      logger: makeLogger(),
    });
    expect(out.factsReEmbedded).toBe(0);
  });

  it('invokes per unique tenant with default limit (500)', async () => {
    const { port, calls } = makePort();
    const out = await runReEmbedStage({
      tenantIds: ['t-1', 't-1', 't-2'],
      reEmbedder: port,
      logger: makeLogger(),
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.limit === 500)).toBe(true);
    expect(out.factsReEmbedded).toBe(14);
  });

  it('forwards perTenantLimit override', async () => {
    const { port, calls } = makePort();
    await runReEmbedStage({
      tenantIds: ['t-1'],
      reEmbedder: port,
      logger: makeLogger(),
      perTenantLimit: 50,
    });
    expect(calls[0]?.limit).toBe(50);
  });

  it('continues past a tenant failure', async () => {
    const { port } = makePort({ failFor: 't-bad' });
    const out = await runReEmbedStage({
      tenantIds: ['t-bad', 't-good'],
      reEmbedder: port,
      logger: makeLogger(),
    });
    expect(out.factsReEmbedded).toBe(7);
  });

  it('forwards modelCutoff to the port', async () => {
    const { port, calls } = makePort();
    const cutoff = new Date('2026-05-01T00:00:00Z');
    await runReEmbedStage({
      tenantIds: ['t-1'],
      reEmbedder: port,
      logger: makeLogger(),
      modelCutoff: cutoff,
    });
    expect(calls[0]?.modelCutoff).toEqual(cutoff);
  });

  it('handles null tenantId (global pool) without crash', async () => {
    const { port, calls } = makePort();
    const out = await runReEmbedStage({
      tenantIds: [null, 't-1'],
      reEmbedder: port,
      logger: makeLogger(),
    });
    expect(calls).toHaveLength(2);
    expect(out.factsReEmbedded).toBe(14);
    expect(out.perTenant.__global__).toBeDefined();
  });
});
