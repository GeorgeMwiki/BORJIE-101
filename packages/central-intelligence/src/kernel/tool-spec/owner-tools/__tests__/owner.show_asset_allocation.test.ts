import { describe, expect, it } from 'vitest';
import {
  createShowAssetAllocationTool,
  type AssetAllocationServicePort,
} from '../owner.show_asset_allocation.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  makeInMemoryOtel,
  ownerScopesFor,
} from './test-rig.js';

function makePort(): AssetAllocationServicePort {
  return {
    async snapshotAssetAllocation(args) {
      return {
        asOfDate: args.asOfDate ?? '2026-05-15',
        totalAssets: 50,
        deployedAssets: 45,
        availableAssets: 3,
        inTransitAssets: 2,
        utilisationRate: 0.9,
        bySite: [
          {
            siteId: 's-1',
            siteName: 'Geita Pit Block A',
            totalAssets: 50,
            deployedAssets: 45,
          },
        ],
      };
    },
  };
}

describe('owner.show_asset_allocation', () => {
  it('happy path — returns coherent snapshot', async () => {
    const tool = createShowAssetAllocationTool({ assetAllocation: makePort() });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.totalAssets).toBe(50);
    expect(out.output.bySite.length).toBe(1);
  });

  it('refuses cross-tenant asset-allocation reads', async () => {
    const tool = createShowAssetAllocationTool({ assetAllocation: makePort() });
    const out = await tool.execute(
      { tenantId: 'tenant-other' },
      buildOwnerCtx({ scopes: ownerScopesFor(DEFAULT_TENANT_ID) }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refuses incoherent payload (sum > totalAssets)', async () => {
    const port: AssetAllocationServicePort = {
      async snapshotAssetAllocation(_args) {
        return {
          asOfDate: '2026-05-15',
          totalAssets: 10,
          deployedAssets: 20, // bogus
          availableAssets: 0,
          inTransitAssets: 0,
          utilisationRate: 1,
          bySite: [],
        };
      },
    };
    const tool = createShowAssetAllocationTool({ assetAllocation: port });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx(),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('INVARIANT_VIOLATION');
  });

  it('emits OTel span tagged read-tier', async () => {
    const otel = makeInMemoryOtel();
    const tool = createShowAssetAllocationTool({ assetAllocation: makePort() });
    await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx({ otel }),
    );
    expect(otel.spans[0]?.name).toBe('tool.owner.show_asset_allocation');
    expect(otel.spans[0]?.attributes['bn.tool.riskTier']).toBe('read');
  });
});
