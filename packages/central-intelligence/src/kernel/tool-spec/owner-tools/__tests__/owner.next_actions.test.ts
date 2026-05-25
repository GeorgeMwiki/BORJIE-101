import { describe, expect, it } from 'vitest';
import {
  createNextActionsTool,
  type NextActionsServicePort,
  type NextActionsOutput,
} from '../owner.next_actions.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  makeInMemoryOtel,
  ownerScopesFor,
} from './test-rig.js';

function makePort(rows: NextActionsOutput['rows'] = []): NextActionsServicePort {
  return {
    async proposeNextActions(args) {
      return {
        rows: rows.slice(0, args.topN),
        generatedAt: '2026-05-15T09:00:00.000Z',
      };
    },
  };
}

const SAMPLE_ROWS: NextActionsOutput['rows'] = [
  {
    id: 'a-1',
    title: 'Chase Asha Kamau on Unit A-101 (14d overdue)',
    rationale: 'Largest aging balance in the portfolio',
    urgency: 'high',
    href: '/portfolio/units/unit-1',
    expectedAt: null,
    estimatedImpactMinorUnits: 45_000_00,
    currency: 'KES',
  },
  {
    id: 'a-2',
    title: 'Renew lease for Unit B-204 (expires in 21d)',
    rationale: 'Top-decile tenant; retention preserves NOI',
    urgency: 'medium',
    href: '/portfolio/units/unit-2',
    expectedAt: '2026-06-05T00:00:00.000Z',
    estimatedImpactMinorUnits: null,
    currency: null,
  },
];

describe('owner.next_actions', () => {
  it('happy path — proposes top-N actions for in-scope tenant', async () => {
    const tool = createNextActionsTool({ proposer: makePort(SAMPLE_ROWS) });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID, topN: 1 },
      buildOwnerCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.rows.length).toBe(1);
    expect(out.output.rows[0]?.id).toBe('a-1');
  });

  it('refuses cross-tenant proposals', async () => {
    const tool = createNextActionsTool({ proposer: makePort(SAMPLE_ROWS) });
    const out = await tool.execute(
      { tenantId: 'tenant-other' },
      buildOwnerCtx({ scopes: ownerScopesFor(DEFAULT_TENANT_ID) }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — topN must be 1..20', () => {
    const tool = createNextActionsTool({ proposer: makePort() });
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', topN: 0 }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', topN: 21 }).success,
    ).toBe(false);
    expect(tool.inputSchema.safeParse({ tenantId: 't', topN: 5 }).success).toBe(
      true,
    );
  });

  it('emits OTel span tagged read-tier', async () => {
    const otel = makeInMemoryOtel();
    const tool = createNextActionsTool({ proposer: makePort(SAMPLE_ROWS) });
    await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx({ otel }),
    );
    expect(otel.spans[0]?.name).toBe('tool.owner.next_actions');
    expect(otel.spans[0]?.attributes['bn.tool.riskTier']).toBe('read');
  });
});
