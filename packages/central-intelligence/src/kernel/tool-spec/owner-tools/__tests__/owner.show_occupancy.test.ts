import { describe, expect, it } from 'vitest';
import {
  createShowOccupancyTool,
  type OccupancyServicePort,
} from '../owner.show_occupancy.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  makeInMemoryOtel,
  ownerScopesFor,
} from './test-rig.js';

function makePort(): OccupancyServicePort {
  return {
    async snapshotOccupancy(args) {
      return {
        asOfDate: args.asOfDate ?? '2026-05-15',
        totalUnits: 50,
        occupiedUnits: 45,
        vacantUnits: 3,
        noticePeriodUnits: 2,
        occupancyRate: 0.9,
        byProperty: [
          {
            propertyId: 'p-1',
            propertyName: 'Ocean View Towers',
            totalUnits: 50,
            occupiedUnits: 45,
          },
        ],
      };
    },
  };
}

describe('owner.show_occupancy', () => {
  it('happy path — returns coherent snapshot', async () => {
    const tool = createShowOccupancyTool({ occupancy: makePort() });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.totalUnits).toBe(50);
    expect(out.output.byProperty.length).toBe(1);
  });

  it('refuses cross-tenant occupancy reads', async () => {
    const tool = createShowOccupancyTool({ occupancy: makePort() });
    const out = await tool.execute(
      { tenantId: 'tenant-other' },
      buildOwnerCtx({ scopes: ownerScopesFor(DEFAULT_TENANT_ID) }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refuses incoherent payload (sum > totalUnits)', async () => {
    const port: OccupancyServicePort = {
      async snapshotOccupancy(args) {
        return {
          asOfDate: '2026-05-15',
          totalUnits: 10,
          occupiedUnits: 20, // bogus
          vacantUnits: 0,
          noticePeriodUnits: 0,
          occupancyRate: 1,
          byProperty: [],
        };
      },
    };
    const tool = createShowOccupancyTool({ occupancy: port });
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
    const tool = createShowOccupancyTool({ occupancy: makePort() });
    await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx({ otel }),
    );
    expect(otel.spans[0]?.name).toBe('tool.owner.show_occupancy');
    expect(otel.spans[0]?.attributes['bn.tool.riskTier']).toBe('read');
  });
});
