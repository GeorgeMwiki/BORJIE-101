/**
 * Batch Sync — Full PostgreSQL → Neo4j data load
 *
 * Used for:
 *  - Initial data population when CPG is first deployed
 *  - Recovery after graph database reset
 *  - Periodic reconciliation to catch any missed events
 *
 * Architecture:
 *  - Reads from PostgreSQL (via passed-in data fetchers)
 *  - Writes to Neo4j in batched UNWIND operations
 *  - Processes entity types in dependency order (properties before units, etc.)
 *  - Reports progress and statistics
 */

import type { GraphSyncEngine, NodeSyncPayload, RelationshipSyncPayload } from './graph-sync-engine.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BatchSyncConfig {
  tenantId: string;
  batchSize: number;
  onProgress?: (phase: string, current: number, total: number) => void;
  onError?: (phase: string, error: Error) => void;
}

export interface DataFetcher {
  /** Fetch properties for a tenant */
  fetchProperties(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch units for a tenant */
  fetchUnits(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch customers for a tenant */
  fetchCustomers(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch leases for a tenant */
  fetchLeases(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch invoices for a tenant */
  fetchInvoices(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch payments for a tenant */
  fetchPayments(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch work orders for a tenant */
  fetchWorkOrders(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch maintenance requests for a tenant */
  fetchMaintenanceRequests(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch vendors for a tenant */
  fetchVendors(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch cases for a tenant */
  fetchCases(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch notices for a tenant */
  fetchNotices(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch documents for a tenant */
  fetchDocuments(tenantId: string): Promise<Record<string, unknown>[]>;
  /** Fetch inspections for a tenant */
  fetchInspections(tenantId: string): Promise<Record<string, unknown>[]>;
}

export interface BatchSyncResult {
  tenantId: string;
  phases: Array<{
    phase: string;
    nodesCreated: number;
    relationshipsCreated: number;
    durationMs: number;
    errors: string[];
  }>;
  totalNodesCreated: number;
  totalRelationshipsCreated: number;
  totalDurationMs: number;
  success: boolean;
}

// ─── Batch Sync ──────────────────────────────────────────────────────────────

/**
 * Phases in dependency order.
 * Properties/Vendors/Customers first, then entities that reference them.
 */
const SYNC_PHASES = [
  'vendors',
  'properties',
  'units',
  'customers',
  'leases',
  'invoices',
  'payments',
  'maintenance_requests',
  'work_orders',
  'documents',
  'inspections',
  'cases',
  'notices',
] as const;

export async function runBatchSync(
  engine: GraphSyncEngine,
  fetcher: DataFetcher,
  config: BatchSyncConfig
): Promise<BatchSyncResult> {
  const startTime = Date.now();
  const result: BatchSyncResult = {
    tenantId: config.tenantId,
    phases: [],
    totalNodesCreated: 0,
    totalRelationshipsCreated: 0,
    totalDurationMs: 0,
    success: true,
  };

  for (const phase of SYNC_PHASES) {
    const phaseStart = Date.now();
    const phaseResult = {
      phase,
      nodesCreated: 0,
      relationshipsCreated: 0,
      durationMs: 0,
      errors: [] as string[],
    };

    try {
      const syncFn = PHASE_HANDLERS[phase];
      if (syncFn) {
        const stats = await syncFn(engine, fetcher, config);
        phaseResult.nodesCreated = stats.nodesCreated;
        phaseResult.relationshipsCreated = stats.relationshipsCreated;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      phaseResult.errors.push(msg);
      result.success = false;
      config.onError?.(phase, err instanceof Error ? err : new Error(msg));
    }

    phaseResult.durationMs = Date.now() - phaseStart;
    result.phases.push(phaseResult);
    result.totalNodesCreated += phaseResult.nodesCreated;
    result.totalRelationshipsCreated += phaseResult.relationshipsCreated;

    config.onProgress?.(phase, result.phases.length, SYNC_PHASES.length);
  }

  result.totalDurationMs = Date.now() - startTime;
  return result;
}

// ─── Phase Handlers ──────────────────────────────────────────────────────────

type PhaseStats = { nodesCreated: number; relationshipsCreated: number };
type PhaseHandler = (
  engine: GraphSyncEngine,
  fetcher: DataFetcher,
  config: BatchSyncConfig
) => Promise<PhaseStats>;

const PHASE_HANDLERS: Record<string, PhaseHandler> = {
  properties: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchProperties(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Property',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const created = await engine.batchUpsertNodes('Property', nodes);
    return { nodesCreated: created, relationshipsCreated: 0 };
  },

  units: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchUnits(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Unit',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('Unit', nodes);

    const rels: RelationshipSyncPayload[] = rows
      .filter(row => row.propertyId)
      .map(row => ({
        fromLabel: 'Property',
        fromId: String(row.propertyId),
        toLabel: 'Unit',
        toId: String(row.id),
        type: 'HAS_UNIT',
        tenantId: config.tenantId,
      }));
    const relsCreated = await engine.batchUpsertRelationships('Property', 'Unit', 'HAS_UNIT', rels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },

  customers: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchCustomers(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Customer',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const created = await engine.batchUpsertNodes('Customer', nodes);
    return { nodesCreated: created, relationshipsCreated: 0 };
  },

  vendors: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchVendors(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Vendor',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const created = await engine.batchUpsertNodes('Vendor', nodes);
    return { nodesCreated: created, relationshipsCreated: 0 };
  },

  leases: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchLeases(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Lease',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('Lease', nodes);

    let relsCreated = 0;

    // Lease → Unit
    const unitRels: RelationshipSyncPayload[] = rows
      .filter(row => row.unitId)
      .map(row => ({
        fromLabel: 'Lease',
        fromId: String(row.id),
        toLabel: 'Unit',
        toId: String(row.unitId),
        type: 'APPLIES_TO',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Lease', 'Unit', 'APPLIES_TO', unitRels);

    // Customer → Lease
    const custRels: RelationshipSyncPayload[] = rows
      .filter(row => row.customerId)
      .map(row => ({
        fromLabel: 'Customer',
        fromId: String(row.customerId),
        toLabel: 'Lease',
        toId: String(row.id),
        type: 'HAS_LEASE',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Customer', 'Lease', 'HAS_LEASE', custRels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },

  invoices: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchInvoices(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Invoice',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('Invoice', nodes);

    let relsCreated = 0;

    const custRels: RelationshipSyncPayload[] = rows
      .filter(row => row.customerId)
      .map(row => ({
        fromLabel: 'Invoice',
        fromId: String(row.id),
        toLabel: 'Customer',
        toId: String(row.customerId),
        type: 'BILLED_TO',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Invoice', 'Customer', 'BILLED_TO', custRels);

    const leaseRels: RelationshipSyncPayload[] = rows
      .filter(row => row.leaseId)
      .map(row => ({
        fromLabel: 'Invoice',
        fromId: String(row.id),
        toLabel: 'Lease',
        toId: String(row.leaseId),
        type: 'FOR_LEASE',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Invoice', 'Lease', 'FOR_LEASE', leaseRels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },

  payments: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchPayments(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Payment',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('Payment', nodes);

    const invRels: RelationshipSyncPayload[] = rows
      .filter(row => row.invoiceId)
      .map(row => ({
        fromLabel: 'Payment',
        fromId: String(row.id),
        toLabel: 'Invoice',
        toId: String(row.invoiceId),
        type: 'PAYS',
        tenantId: config.tenantId,
      }));
    const relsCreated = await engine.batchUpsertRelationships('Payment', 'Invoice', 'PAYS', invRels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },

  maintenance_requests: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchMaintenanceRequests(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'MaintenanceRequest',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('MaintenanceRequest', nodes);

    const unitRels: RelationshipSyncPayload[] = rows
      .filter(row => row.unitId)
      .map(row => ({
        fromLabel: 'MaintenanceRequest',
        fromId: String(row.id),
        toLabel: 'Unit',
        toId: String(row.unitId),
        type: 'ABOUT',
        tenantId: config.tenantId,
      }));
    const relsCreated = await engine.batchUpsertRelationships('MaintenanceRequest', 'Unit', 'ABOUT', unitRels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },

  work_orders: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchWorkOrders(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'WorkOrder',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('WorkOrder', nodes);

    let relsCreated = 0;

    const unitRels: RelationshipSyncPayload[] = rows
      .filter(row => row.unitId)
      .map(row => ({
        fromLabel: 'WorkOrder',
        fromId: String(row.id),
        toLabel: 'Unit',
        toId: String(row.unitId),
        type: 'TARGETS',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('WorkOrder', 'Unit', 'TARGETS', unitRels);

    const vendorRels: RelationshipSyncPayload[] = rows
      .filter(row => row.vendorId)
      .map(row => ({
        fromLabel: 'WorkOrder',
        fromId: String(row.id),
        toLabel: 'Vendor',
        toId: String(row.vendorId),
        type: 'ASSIGNED_TO',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('WorkOrder', 'Vendor', 'ASSIGNED_TO', vendorRels);

    const maintRels: RelationshipSyncPayload[] = rows
      .filter(row => row.maintenanceRequestId)
      .map(row => ({
        fromLabel: 'WorkOrder',
        fromId: String(row.id),
        toLabel: 'MaintenanceRequest',
        toId: String(row.maintenanceRequestId),
        type: 'CREATED_FROM',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('WorkOrder', 'MaintenanceRequest', 'CREATED_FROM', maintRels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },

  documents: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchDocuments(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Document',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const created = await engine.batchUpsertNodes('Document', nodes);
    return { nodesCreated: created, relationshipsCreated: 0 };
  },

  inspections: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchInspections(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Inspection',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const created = await engine.batchUpsertNodes('Inspection', nodes);
    return { nodesCreated: created, relationshipsCreated: 0 };
  },

  cases: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchCases(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Case',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('Case', nodes);

    let relsCreated = 0;

    const custRels: RelationshipSyncPayload[] = rows
      .filter(row => row.customerId)
      .map(row => ({
        fromLabel: 'Case',
        fromId: String(row.id),
        toLabel: 'Customer',
        toId: String(row.customerId),
        type: 'OPENED_BY',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Case', 'Customer', 'OPENED_BY', custRels);

    const unitRels: RelationshipSyncPayload[] = rows
      .filter(row => row.unitId)
      .map(row => ({
        fromLabel: 'Case',
        fromId: String(row.id),
        toLabel: 'Unit',
        toId: String(row.unitId),
        type: 'CASE_ABOUT',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Case', 'Unit', 'CASE_ABOUT', unitRels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },

  notices: async (engine, fetcher, config) => {
    const rows = await fetcher.fetchNotices(config.tenantId);
    const nodes: NodeSyncPayload[] = rows.map(row => ({
      label: 'Notice',
      id: String(row.id),
      tenantId: config.tenantId,
      properties: row,
    }));
    const nodesCreated = await engine.batchUpsertNodes('Notice', nodes);

    let relsCreated = 0;

    const caseRels: RelationshipSyncPayload[] = rows
      .filter(row => row.caseId)
      .map(row => ({
        fromLabel: 'Notice',
        fromId: String(row.id),
        toLabel: 'Case',
        toId: String(row.caseId),
        type: 'ISSUED_FOR',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Notice', 'Case', 'ISSUED_FOR', caseRels);

    const custRels: RelationshipSyncPayload[] = rows
      .filter(row => row.customerId)
      .map(row => ({
        fromLabel: 'Notice',
        fromId: String(row.id),
        toLabel: 'Customer',
        toId: String(row.customerId),
        type: 'SERVED_TO',
        tenantId: config.tenantId,
      }));
    relsCreated += await engine.batchUpsertRelationships('Notice', 'Customer', 'SERVED_TO', custRels);

    return { nodesCreated, relationshipsCreated: relsCreated };
  },
};
