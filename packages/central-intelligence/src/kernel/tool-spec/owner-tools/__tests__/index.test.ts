import { describe, expect, it } from 'vitest';
import { createBrainToolRegistry } from '../../../tool-spec.js';
import {
  OWNER_TOOL_NAMES,
  OWNER_TOOL_TIERS,
  adaptOwnerToolSpec,
  assertOwnerToolSpecValid,
  brainTierForOwnerTier,
  seedOwnerBrainTools,
} from '../index.js';
import type { OwnerToolSpec } from '../types.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  ownerScopesFor,
} from './test-rig.js';
import { z } from 'zod';

const NOOP_FACTORY = () => buildOwnerCtx();

const STUB_OUTSTANDING = {
  async listOutstanding() {
    return {
      rows: [],
      totalReturned: 0,
      totalAmountMinorUnits: 0,
      currency: 'TZS' as const,
    };
  },
};

const STUB_NOTICES = {
  async draftNotice(args: {
    tenantId: string;
    siteId: string;
    operatorId: string;
    breachKind: 'outstanding' | 'damage' | 'unauthorised-operators' | 'illicit-use' | 'other';
    breachSummary: string;
  }) {
    return {
      draftId: 'd-1',
      tenantId: args.tenantId,
      siteId: args.siteId,
      operatorId: args.operatorId,
      breachKind: args.breachKind,
      bodyMarkdown: 'body',
      createdAt: '2026-05-15T09:00:00.000Z',
      status: 'draft' as const,
    };
  },
  async deleteDraft() {},
};

const STUB_ASSET_ALLOCATION = {
  async snapshotAssetAllocation(args: { tenantId: string; asOfDate: string | null }) {
    return {
      asOfDate: args.asOfDate ?? '2026-05-15',
      totalAssets: 0,
      deployedAssets: 0,
      availableAssets: 0,
      inTransitAssets: 0,
      utilisationRate: 0,
      bySite: [],
    };
  },
};

const STUB_PROPOSER = {
  async proposeNextActions() {
    return { rows: [], generatedAt: '2026-05-15T09:00:00.000Z' };
  },
};

const STUB_FINANCIALS = {
  async summariseFinancials(args: {
    tenantId: string;
    windowMonths: number;
    currency: 'KES' | 'TZS' | 'USD';
  }) {
    return {
      windowMonths: args.windowMonths,
      currency: args.currency,
      totalCollectedMinorUnits: 0,
      totalBilledMinorUnits: 0,
      collectionRate: 0,
      outstandingMinorUnits: 0,
      monthly: [],
    };
  },
};

describe('owner-tools — registry adapter', () => {
  it('OWNER_TOOL_NAMES matches the 5 expected verbs', () => {
    expect(OWNER_TOOL_NAMES).toEqual([
      'owner.list_outstanding',
      'owner.draft_suspension_notice',
      'owner.show_asset_allocation',
      'owner.next_actions',
      'owner.financial_summary',
    ]);
  });

  it('tier map: read tools → free, mutate → pro', () => {
    expect(brainTierForOwnerTier('read')).toBe('free');
    expect(brainTierForOwnerTier('mutate')).toBe('pro');
    expect(OWNER_TOOL_TIERS['owner.list_outstanding']).toBe('read');
    expect(OWNER_TOOL_TIERS['owner.draft_suspension_notice']).toBe('mutate');
  });

  it('assertOwnerToolSpecValid rejects bad names', () => {
    const bad: OwnerToolSpec = {
      // @ts-expect-error: intentionally invalid name
      name: 'platform.bad',
      riskTier: 'read',
      description: '',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      requiredScopes: [],
      approvalRequired: false,
      execute: async () => ({ kind: 'ok', output: {} }),
    };
    expect(() => assertOwnerToolSpecValid(bad)).toThrow(/must start with "owner\."/);
  });

  it('assertOwnerToolSpecValid rejects mutate without rollback', () => {
    const bad: OwnerToolSpec = {
      name: 'owner.thing',
      riskTier: 'mutate',
      description: '',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      requiredScopes: [],
      approvalRequired: false,
      execute: async () => ({ kind: 'ok', output: {} }),
    };
    expect(() => assertOwnerToolSpecValid(bad)).toThrow(/rollback/);
  });

  it('seedOwnerBrainTools registers 5 tools on the registry', () => {
    const registry = createBrainToolRegistry();
    const names = seedOwnerBrainTools(registry, {
      outstanding: STUB_OUTSTANDING,
      notices: STUB_NOTICES,
      assetAllocation: STUB_ASSET_ALLOCATION,
      proposer: STUB_PROPOSER,
      financials: STUB_FINANCIALS,
      contextFactory: NOOP_FACTORY,
    });
    expect(names.length).toBe(5);
    expect(registry.get('owner.list_outstanding')).not.toBeNull();
    expect(registry.get('owner.draft_suspension_notice')).not.toBeNull();
  });

  it('adapter surfaces refusal as a thrown error tagged owner-tool-refused', async () => {
    const registry = createBrainToolRegistry();
    seedOwnerBrainTools(registry, {
      outstanding: STUB_OUTSTANDING,
      notices: STUB_NOTICES,
      assetAllocation: STUB_ASSET_ALLOCATION,
      proposer: STUB_PROPOSER,
      financials: STUB_FINANCIALS,
      contextFactory: () =>
        buildOwnerCtx({
          // Caller scoped to a DIFFERENT tenant than the input.
          scopes: ownerScopesFor('other-tenant'),
        }),
    });
    const outcome = await registry.runTool('owner.list_outstanding', {
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(outcome.kind).toBe('executor-failed');
    if (outcome.kind !== 'executor-failed') throw new Error('expected fail');
    expect(outcome.message).toMatch(/owner-tool-refused/);
    expect(outcome.message).toMatch(/OUT_OF_SCOPE/);
  });
});
