import { describe, it, expect } from 'vitest';
import {
  createListRecentTracesTool,
  type DecisionTraceQueryPort,
} from '../platform.list_recent_traces.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

const SEED = [
  {
    traceId: 'tr-1',
    threadId: 'th-1',
    tenantId: 't-alpha',
    capability: 'jarvis.chat',
    score: 0.82,
    stepCount: 13,
    startedAt: '2026-05-15T08:00:00.000Z',
    finishedAt: '2026-05-15T08:00:02.300Z',
  },
  {
    traceId: 'tr-2',
    threadId: 'th-2',
    tenantId: 't-beta',
    capability: 'jarvis.chat',
    score: 0.74,
    stepCount: 11,
    startedAt: '2026-05-15T08:05:00.000Z',
    finishedAt: '2026-05-15T08:05:01.900Z',
  },
];

function stub(rows: typeof SEED): DecisionTraceQueryPort {
  return {
    async listRecent(args) {
      return rows.filter(
        (r) =>
          (args.capability === null || r.capability === args.capability) &&
          (args.scoreMin === null || (r.score ?? 0) >= args.scoreMin) &&
          (args.tenantId === null || r.tenantId === args.tenantId),
      );
    },
  };
}

describe('platform.list_recent_traces', () => {
  it('happy path — platform admin sees all traces', async () => {
    const tool = createListRecentTracesTool({ traces: stub(SEED) });
    const out = await tool.execute({ limit: 25 }, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.rows).toHaveLength(2);
  });

  it('auth-gated — non-ops caller refused', async () => {
    const tool = createListRecentTracesTool({ traces: stub(SEED) });
    const out = await tool.execute(
      {},
      buildCtx({ scopes: ['platform:tenants:read'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses tenant filter caller cannot reach', async () => {
    const tool = createListRecentTracesTool({ traces: stub(SEED) });
    const out = await tool.execute(
      { tenantId: 't-beta' },
      buildCtx({
        scopes: ['platform:ops:read', ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('input validation — scoreMin > 1 fails schema', () => {
    expect(
      createListRecentTracesTool({ traces: stub(SEED) }).inputSchema.safeParse({
        scoreMin: 1.7,
      }).success,
    ).toBe(false);
  });

  it('drops out-of-reach rows from server response', async () => {
    const tool = createListRecentTracesTool({ traces: stub(SEED) });
    const out = await tool.execute(
      {},
      buildCtx({
        scopes: ['platform:ops:read', ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.rows.map((r) => r.traceId)).toEqual(['tr-1']);
  });
});
