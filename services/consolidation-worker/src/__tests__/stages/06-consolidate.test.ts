/**
 * Stage 06 — consolidate unit tests.
 *
 * Coverage:
 *   1. no consolidator wired → zero report, no throw
 *   2. invoked once per unique tenant
 *   3. tenant failure isolated; others continue
 *   4. null tenantId is SKIPPED (cross-tenant privacy boundary)
 *   5. report aggregates mergedEntities across tenants
 *   6. logger emits 'algorithm=louvain' metadata
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runConsolidateStage,
  type EntityConsolidatorPort,
} from '../../stages/06-consolidate.js';
import type { StageLogger } from '../../stages/types.js';

function makeLogger(): StageLogger & {
  infoCalls: Array<{ obj: Record<string, unknown>; msg?: string }>;
  warnCalls: Array<{ obj: Record<string, unknown>; msg?: string }>;
} {
  const infoCalls: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const warnCalls: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  return {
    info: vi.fn((obj, msg) => {
      infoCalls.push({ obj, msg });
    }),
    warn: vi.fn((obj, msg) => {
      warnCalls.push({ obj, msg });
    }),
    error: vi.fn(),
    infoCalls,
    warnCalls,
  };
}

function makePort(opts: { failFor?: string; merged?: number } = {}): {
  port: EntityConsolidatorPort;
  calls: Array<{ tenantId: string | null }>;
} {
  const calls: Array<{ tenantId: string | null }> = [];
  const port: EntityConsolidatorPort = {
    async consolidateForTenant(args) {
      calls.push({ tenantId: args.tenantId });
      if (opts.failFor !== undefined && args.tenantId === opts.failFor) {
        throw new Error('boom');
      }
      return {
        tenantId: args.tenantId,
        mergedEntities: opts.merged ?? 2,
        inspectedEntities: 10,
      };
    },
  };
  return { port, calls };
}

describe('runConsolidateStage', () => {
  it('is a no-op when no consolidator wired', async () => {
    const out = await runConsolidateStage({
      tenantIds: ['t-1'],
      logger: makeLogger(),
    });
    expect(out.entitiesMerged).toBe(0);
  });

  it('invokes per unique tenant', async () => {
    const { port, calls } = makePort();
    const out = await runConsolidateStage({
      tenantIds: ['t-1', 't-1', 't-2'],
      consolidator: port,
      logger: makeLogger(),
    });
    expect(calls).toHaveLength(2);
    expect(out.entitiesMerged).toBe(4);
  });

  it('continues after one tenant fails', async () => {
    const { port } = makePort({ failFor: 't-bad' });
    const out = await runConsolidateStage({
      tenantIds: ['t-bad', 't-good'],
      consolidator: port,
      logger: makeLogger(),
    });
    expect(out.entitiesMerged).toBe(2);
  });

  it('skips null tenantId (privacy boundary)', async () => {
    const { port, calls } = makePort();
    const out = await runConsolidateStage({
      tenantIds: [null, 't-1'],
      consolidator: port,
      logger: makeLogger(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tenantId).toBe('t-1');
    expect(out.entitiesMerged).toBe(2);
  });

  it('aggregates mergedEntities across tenants', async () => {
    const { port } = makePort({ merged: 7 });
    const out = await runConsolidateStage({
      tenantIds: ['t-1', 't-2', 't-3'],
      consolidator: port,
      logger: makeLogger(),
    });
    expect(out.entitiesMerged).toBe(21);
    expect(Object.keys(out.perTenant)).toHaveLength(3);
  });

  it('logs algorithm=louvain on completion', async () => {
    const { port } = makePort();
    const logger = makeLogger();
    await runConsolidateStage({
      tenantIds: ['t-1'],
      consolidator: port,
      logger,
    });
    const complete = logger.infoCalls.find(
      (c) => c.msg === 'consolidate stage complete',
    );
    expect(complete?.obj.algorithm).toBe('louvain');
  });
});
