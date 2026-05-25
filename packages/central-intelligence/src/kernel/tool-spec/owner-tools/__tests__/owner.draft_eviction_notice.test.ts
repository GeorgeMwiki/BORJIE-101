import { describe, expect, it } from 'vitest';
import {
  createDraftEvictionNoticeTool,
  type EvictionNoticeDraftPort,
  type DraftEvictionNoticeOutput,
} from '../owner.draft_eviction_notice.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  makeInMemoryOtel,
  ownerScopesFor,
} from './test-rig.js';

function makePort(): {
  port: EvictionNoticeDraftPort;
  deletes: string[];
  responses: Array<DraftEvictionNoticeOutput>;
} {
  const deletes: string[] = [];
  const responses: DraftEvictionNoticeOutput[] = [];
  let id = 0;
  return {
    deletes,
    responses,
    port: {
      async draftNotice(args) {
        id += 1;
        const out: DraftEvictionNoticeOutput = {
          draftId: `draft-${id}`,
          tenantId: args.tenantId,
          unitId: args.unitId,
          occupantId: args.occupantId,
          breachKind: args.breachKind,
          bodyMarkdown: `# Notice draft for unit ${args.unitId}\n\n${args.breachSummary}`,
          createdAt: '2026-05-15T09:00:00.000Z',
          status: 'draft',
        };
        responses.push(out);
        return out;
      },
      async deleteDraft(draftId) {
        deletes.push(draftId);
      },
    },
  };
}

const VALID_INPUT = {
  tenantId: DEFAULT_TENANT_ID,
  unitId: 'unit-1',
  occupantId: 'occupant-1',
  breachKind: 'arrears' as const,
  breachSummary: 'Rent unpaid for 45 days; multiple reminders ignored.',
};

describe('owner.draft_eviction_notice', () => {
  it('happy path — drafts a non-binding notice for in-scope tenant', async () => {
    const { port } = makePort();
    const tool = createDraftEvictionNoticeTool({ notices: port });
    const out = await tool.execute(VALID_INPUT, buildOwnerCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.status).toBe('draft');
    expect(out.output.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(out.output.bodyMarkdown).toContain('unit-1');
  });

  it('refuses cross-tenant draft (OUT_OF_SCOPE)', async () => {
    const { port } = makePort();
    const tool = createDraftEvictionNoticeTool({ notices: port });
    const out = await tool.execute(
      { ...VALID_INPUT, tenantId: 'tenant-other' },
      buildOwnerCtx({ scopes: ownerScopesFor(DEFAULT_TENANT_ID) }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refuses when port returns non-draft status (INVARIANT_VIOLATION)', async () => {
    const port: EvictionNoticeDraftPort = {
      async draftNotice(args) {
        return {
          draftId: 'd-1',
          tenantId: args.tenantId,
          unitId: args.unitId,
          occupantId: args.occupantId,
          breachKind: args.breachKind,
          bodyMarkdown: 'body',
          createdAt: '2026-05-15T09:00:00.000Z',
          // BUG simulation: port forgot to keep status=draft.
          status: 'sent' as unknown as 'draft',
        };
      },
      async deleteDraft() {},
    };
    const tool = createDraftEvictionNoticeTool({ notices: port });
    const out = await tool.execute(VALID_INPUT, buildOwnerCtx());
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('INVARIANT_VIOLATION');
  });

  it('rollback deletes the draft row by id', async () => {
    const { port, deletes } = makePort();
    const tool = createDraftEvictionNoticeTool({ notices: port });
    const out = await tool.execute(VALID_INPUT, buildOwnerCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildOwnerCtx());
    expect(deletes).toEqual([out.output.draftId]);
  });

  it('input validation — breachSummary length 10..500', () => {
    const { port } = makePort();
    const tool = createDraftEvictionNoticeTool({ notices: port });
    expect(
      tool.inputSchema.safeParse({ ...VALID_INPUT, breachSummary: 'tooshort' })
        .success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        breachSummary: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('emits OTel span tagged mutate-tier', async () => {
    const otel = makeInMemoryOtel();
    const { port } = makePort();
    const tool = createDraftEvictionNoticeTool({ notices: port });
    await tool.execute(VALID_INPUT, buildOwnerCtx({ otel }));
    expect(otel.spans[0]?.name).toBe('tool.owner.draft_eviction_notice');
    expect(otel.spans[0]?.attributes['bn.tool.riskTier']).toBe('mutate');
  });
});
