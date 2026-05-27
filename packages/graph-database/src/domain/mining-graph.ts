/**
 * Mining-domain graph wrappers — Mr. Mwikila.
 *
 * Each wrapper produces a tenant-scoped `CypherQuery` for a
 * well-known mining-domain projection. The wrappers compose the
 * `CypherBuilder` and so inherit the tenant-isolation invariant
 * automatically — there is no path that escapes tenant scoping.
 *
 * Wrappers:
 *
 *   - `licencePermitHierarchy(tenantId)` — Licence → Permit → Mine →
 *     Pit → Worker hierarchy used by the regulator filing engine.
 *
 *   - `supplyChainProvenance(tenantId, mineralLotId)` — directed
 *     custody chain from a MineralLot forward to Export / Sale.
 *
 *   - `workerCertificationGraph(tenantId, workerId)` — Worker →
 *     Certification → Regulator, with expiry. Drives the
 *     workforce-mobile compliance widget.
 *
 *   - `buyerNetwork(tenantId)` — bipartite Buyer ↔ Mine and Buyer ↔
 *     Mineral. Feeds the buyer-mobile marketplace ranker.
 *
 * @module @borjie/graph-database/domain/mining-graph
 */

import { cypher, type CypherBuilder } from '../query/cypher-builder.js';
import {
  GraphDatabaseError,
  type CypherQuery,
} from '../types.js';

// ---------------------------------------------------------------------------
// Mining label constants
// ---------------------------------------------------------------------------

export const MINING_LABELS = {
  Licence: 'Licence',
  Permit: 'Permit',
  Mine: 'Mine',
  Pit: 'Pit',
  Worker: 'Worker',
  Certification: 'Certification',
  Regulator: 'Regulator',
  MineralLot: 'MineralLot',
  Custodian: 'Custodian',
  Export: 'Export',
  Sale: 'Sale',
  Buyer: 'Buyer',
  Mineral: 'Mineral',
} as const;

export const MINING_REL_TYPES = {
  GRANTS: 'GRANTS',
  COVERS: 'COVERS',
  HAS_PIT: 'HAS_PIT',
  STAFFS: 'STAFFS',
  HOLDS: 'HOLDS',
  ISSUED_BY: 'ISSUED_BY',
  CUSTODY_TO: 'CUSTODY_TO',
  RESULTED_IN: 'RESULTED_IN',
  BOUGHT_FROM: 'BOUGHT_FROM',
  INTERESTED_IN: 'INTERESTED_IN',
} as const;

// ---------------------------------------------------------------------------
// licencePermitHierarchy
// ---------------------------------------------------------------------------

export interface LicencePermitHierarchyArgs {
  readonly tenantId: string;
  readonly limit?: number;
}

export function licencePermitHierarchy(
  args: LicencePermitHierarchyArgs,
): CypherQuery {
  assertTenant(args.tenantId, 'licencePermitHierarchy');
  let builder: CypherBuilder = cypher()
    .tenant(args.tenantId)
    .match({ variable: 'l', labels: [MINING_LABELS.Licence], properties: {} })
    .matchRel({
      fromVariable: 'l',
      toVariable: 'p',
      type: MINING_REL_TYPES.GRANTS,
      direction: 'out',
      properties: {},
    })
    .match({ variable: 'p', labels: [MINING_LABELS.Permit], properties: {} })
    .matchRel({
      fromVariable: 'p',
      toVariable: 'm',
      type: MINING_REL_TYPES.COVERS,
      direction: 'out',
      properties: {},
    })
    .match({ variable: 'm', labels: [MINING_LABELS.Mine], properties: {} })
    .matchRel({
      fromVariable: 'm',
      toVariable: 'pit',
      type: MINING_REL_TYPES.HAS_PIT,
      direction: 'out',
      properties: {},
    })
    .match({ variable: 'pit', labels: [MINING_LABELS.Pit], properties: {} })
    .optionalMatch({
      variable: 'w',
      labels: [MINING_LABELS.Worker],
      properties: {},
    })
    .matchRel({
      fromVariable: 'pit',
      toVariable: 'w',
      type: MINING_REL_TYPES.STAFFS,
      direction: 'out',
      properties: {},
    })
    .return(
      'l.id AS licenceId, p.id AS permitId, m.id AS mineId, pit.id AS pitId, w.id AS workerId',
    );
  if (args.limit !== undefined) {
    builder = builder.limit(args.limit);
  }
  return builder.build();
}

// ---------------------------------------------------------------------------
// supplyChainProvenance
// ---------------------------------------------------------------------------

export interface SupplyChainProvenanceArgs {
  readonly tenantId: string;
  readonly mineralLotId: string;
}

export function supplyChainProvenance(
  args: SupplyChainProvenanceArgs,
): CypherQuery {
  assertTenant(args.tenantId, 'supplyChainProvenance');
  if (!args.mineralLotId || args.mineralLotId.trim().length === 0) {
    throw new GraphDatabaseError(
      'parameter_validation_failed',
      'supplyChainProvenance requires a non-empty mineralLotId',
    );
  }
  return cypher()
    .tenant(args.tenantId)
    .param('mineralLotId', args.mineralLotId)
    .match({
      variable: 'lot',
      labels: [MINING_LABELS.MineralLot],
      properties: { id: '$mineralLotId' },
    })
    .matchRel({
      fromVariable: 'lot',
      toVariable: 'custodian',
      type: MINING_REL_TYPES.CUSTODY_TO,
      direction: 'out',
      properties: {},
    })
    .match({
      variable: 'custodian',
      labels: [MINING_LABELS.Custodian],
      properties: {},
    })
    .optionalMatch({
      variable: 'ex',
      labels: [MINING_LABELS.Export],
      properties: {},
    })
    .matchRel({
      fromVariable: 'custodian',
      toVariable: 'ex',
      type: MINING_REL_TYPES.RESULTED_IN,
      direction: 'out',
      properties: {},
    })
    .optionalMatch({
      variable: 'sale',
      labels: [MINING_LABELS.Sale],
      properties: {},
    })
    .matchRel({
      fromVariable: 'custodian',
      toVariable: 'sale',
      type: MINING_REL_TYPES.RESULTED_IN,
      direction: 'out',
      properties: {},
    })
    .return(
      'lot.id AS mineralLotId, custodian.id AS custodianId, ex.id AS exportId, sale.id AS saleId',
    )
    .build();
}

// ---------------------------------------------------------------------------
// workerCertificationGraph
// ---------------------------------------------------------------------------

export interface WorkerCertificationGraphArgs {
  readonly tenantId: string;
  readonly workerId: string;
}

export function workerCertificationGraph(
  args: WorkerCertificationGraphArgs,
): CypherQuery {
  assertTenant(args.tenantId, 'workerCertificationGraph');
  if (!args.workerId || args.workerId.trim().length === 0) {
    throw new GraphDatabaseError(
      'parameter_validation_failed',
      'workerCertificationGraph requires a non-empty workerId',
    );
  }
  return cypher()
    .tenant(args.tenantId)
    .param('workerId', args.workerId)
    .match({
      variable: 'w',
      labels: [MINING_LABELS.Worker],
      properties: { id: '$workerId' },
    })
    .matchRel({
      fromVariable: 'w',
      toVariable: 'c',
      type: MINING_REL_TYPES.HOLDS,
      direction: 'out',
      properties: {},
    })
    .match({
      variable: 'c',
      labels: [MINING_LABELS.Certification],
      properties: {},
    })
    .matchRel({
      fromVariable: 'c',
      toVariable: 'r',
      type: MINING_REL_TYPES.ISSUED_BY,
      direction: 'out',
      properties: {},
    })
    .match({
      variable: 'r',
      labels: [MINING_LABELS.Regulator],
      properties: {},
    })
    .return(
      'w.id AS workerId, c.id AS certificationId, c.expiresAt AS expiresAt, r.id AS regulatorId',
    )
    .build();
}

// ---------------------------------------------------------------------------
// buyerNetwork
// ---------------------------------------------------------------------------

export interface BuyerNetworkArgs {
  readonly tenantId: string;
  readonly buyerId?: string;
  readonly limit?: number;
}

export function buyerNetwork(args: BuyerNetworkArgs): CypherQuery {
  assertTenant(args.tenantId, 'buyerNetwork');
  let builder: CypherBuilder = cypher().tenant(args.tenantId);
  if (args.buyerId !== undefined && args.buyerId.length > 0) {
    builder = builder.param('buyerId', args.buyerId).match({
      variable: 'b',
      labels: [MINING_LABELS.Buyer],
      properties: { id: '$buyerId' },
    });
  } else {
    builder = builder.match({
      variable: 'b',
      labels: [MINING_LABELS.Buyer],
      properties: {},
    });
  }
  builder = builder
    .optionalMatch({
      variable: 'm',
      labels: [MINING_LABELS.Mine],
      properties: {},
    })
    .matchRel({
      fromVariable: 'b',
      toVariable: 'm',
      type: MINING_REL_TYPES.BOUGHT_FROM,
      direction: 'out',
      properties: {},
    })
    .optionalMatch({
      variable: 'mineral',
      labels: [MINING_LABELS.Mineral],
      properties: {},
    })
    .matchRel({
      fromVariable: 'b',
      toVariable: 'mineral',
      type: MINING_REL_TYPES.INTERESTED_IN,
      direction: 'out',
      properties: {},
    })
    .return(
      'b.id AS buyerId, m.id AS mineId, mineral.id AS mineralId',
    );
  if (args.limit !== undefined) {
    builder = builder.limit(args.limit);
  }
  return builder.build();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function assertTenant(tenantId: string, wrapper: string): void {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      `${wrapper} requires a non-empty tenantId`,
    );
  }
}
