/**
 * Graph Sync Engine — PostgreSQL → Neo4j ETL
 *
 * Incrementally syncs relational data into the Canonical Property Graph.
 *
 * Architecture:
 *  - PostgreSQL is the source of truth (ACID transactions)
 *  - Neo4j is a read-optimized projection for the AI layer
 *  - Sync is triggered by domain events (outbox pattern) or periodic batch
 *  - Each sync operation is idempotent (MERGE-based)
 *
 * Design decisions:
 *  - Uses MERGE (not CREATE) to ensure idempotency
 *  - All nodes carry _tenantId for multi-tenant isolation
 *  - _syncedAt tracks freshness
 *  - Batch operations for throughput (UNWIND pattern)
 */

import type { Neo4jClient } from '../client/neo4j-client.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncEvent {
  eventType: string;       // e.g., 'property.created', 'lease.activated'
  tenantId: string;
  entityType: string;      // e.g., 'Property', 'Lease'
  entityId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface SyncResult {
  nodesCreated: number;
  nodesUpdated: number;
  relationshipsCreated: number;
  relationshipsUpdated: number;
  errors: string[];
  durationMs: number;
}

export interface NodeSyncPayload {
  label: string;
  id: string;
  tenantId: string;
  properties: Record<string, unknown>;
}

export interface RelationshipSyncPayload {
  fromLabel: string;
  fromId: string;
  toLabel: string;
  toId: string;
  type: string;
  tenantId: string;
  properties?: Record<string, unknown>;
}

// ─── Sync Engine ─────────────────────────────────────────────────────────────

/**
 * SECURITY: Cypher does not parameterise labels or relationship types, so they
 * MUST be interpolated into the query string. To prevent Cypher injection via
 * a malicious upstream `event.entityType` (or any caller-supplied label/type)
 * we hard-restrict identifiers to a safe alphanumeric shape before
 * interpolating. Anything else throws before the query runs.
 */
const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function assertSafeIdent(value: string, kind: 'label' | 'relationship type'): string {
  if (typeof value !== 'string' || !SAFE_IDENT_RE.test(value)) {
    throw new Error(
      `graph-sync: invalid ${kind} "${String(value)}" — must match ${SAFE_IDENT_RE.source}`,
    );
  }
  return value;
}

/**
 * Asserts every payload in a batch shares the same non-empty `tenantId`
 * and returns it. Throws before any Cypher reaches Neo4j when callers
 * smuggle a foreign row into the batch — a class of bug that the
 * tenant-scoped Cypher gate could not catch on its own (the gate runs
 * per query, not per row).
 */
function assertHomogenousTenant(tenantIds: ReadonlyArray<string>, caller: string): string {
  if (tenantIds.length === 0) {
    throw new Error(`graph-sync.${caller}: empty batch — caller should short-circuit`);
  }
  const first = tenantIds[0];
  if (typeof first !== 'string' || first.trim().length === 0) {
    throw new Error(`graph-sync.${caller}: tenantId is required and must be a non-empty string`);
  }
  for (let i = 1; i < tenantIds.length; i++) {
    if (tenantIds[i] !== first) {
      throw new Error(
        `graph-sync.${caller}: heterogeneous tenantId batch (${first} vs ${tenantIds[i]}) — refusing to risk cross-tenant write`,
      );
    }
  }
  return first;
}

export class GraphSyncEngine {
  constructor(private client: Neo4jClient) {}

  /**
   * Upsert a single node (idempotent via MERGE)
   */
  async upsertNode(payload: NodeSyncPayload): Promise<void> {
    const label = assertSafeIdent(payload.label, 'label');
    const cypher = `
      MERGE (n:${label} {_tenantId: $tenantId, _id: $id})
      SET n += $properties,
          n._syncedAt = datetime(),
          n._sourceTable = $sourceTable
    `;

    await this.client.writeQuery(cypher, {
      tenantId: payload.tenantId,
      id: payload.id,
      properties: sanitizeProperties(payload.properties),
      sourceTable: label.toLowerCase() + 's',
    });
  }

  /**
   * Batch upsert nodes (high throughput via UNWIND).
   *
   * TENANT ISOLATION: every payload MUST share the same `tenantId`. We
   * enforce that here (no silent cross-tenant batches) and embed the
   * top-level `$tenantId` in the Cypher so the tenant-scope guard fires
   * and the per-row `node.tenantId` is hard-pinned to it via a `WITH`
   * filter — defence in depth against a caller smuggling a foreign row
   * into the batch.
   */
  async batchUpsertNodes(label: string, nodes: NodeSyncPayload[]): Promise<number> {
    if (nodes.length === 0) return 0;
    const safeLabel = assertSafeIdent(label, 'label');
    const tenantId = assertHomogenousTenant(nodes.map(n => n.tenantId), 'batchUpsertNodes');

    const cypher = `
      UNWIND $nodes AS node
      WITH node WHERE node.tenantId = $tenantId
      MERGE (n:${safeLabel} {_tenantId: $tenantId, _id: node.id})
      SET n += node.properties,
          n._syncedAt = datetime(),
          n._sourceTable = $sourceTable
    `;

    const nodeData = nodes.map(n => ({
      tenantId: n.tenantId,
      id: n.id,
      properties: sanitizeProperties(n.properties),
    }));

    await this.client.writeQuery(cypher, {
      tenantId,
      nodes: nodeData,
      sourceTable: safeLabel.toLowerCase() + 's',
    });

    return nodes.length;
  }

  /**
   * Upsert a relationship (idempotent via MERGE)
   */
  async upsertRelationship(payload: RelationshipSyncPayload): Promise<void> {
    const fromLabel = assertSafeIdent(payload.fromLabel, 'label');
    const toLabel = assertSafeIdent(payload.toLabel, 'label');
    const relType = assertSafeIdent(payload.type, 'relationship type');
    const cypher = `
      MATCH (a:${fromLabel} {_tenantId: $tenantId, _id: $fromId})
      MATCH (b:${toLabel} {_tenantId: $tenantId, _id: $toId})
      MERGE (a)-[r:${relType}]->(b)
      SET r += $properties,
          r._syncedAt = datetime()
    `;

    await this.client.writeQuery(cypher, {
      tenantId: payload.tenantId,
      fromId: payload.fromId,
      toId: payload.toId,
      properties: sanitizeProperties(payload.properties ?? {}),
    });
  }

  /**
   * Batch upsert relationships (high throughput via UNWIND).
   *
   * TENANT ISOLATION: every payload MUST share the same `tenantId`. We
   * enforce that here, embed the top-level `$tenantId` in the Cypher so
   * the tenant-scope guard fires, and filter out any row whose
   * per-record `tenantId` doesn't match — defence in depth against
   * cross-tenant smuggling.
   */
  async batchUpsertRelationships(
    fromLabel: string,
    toLabel: string,
    relType: string,
    relationships: RelationshipSyncPayload[]
  ): Promise<number> {
    if (relationships.length === 0) return 0;
    const safeFrom = assertSafeIdent(fromLabel, 'label');
    const safeTo = assertSafeIdent(toLabel, 'label');
    const safeRel = assertSafeIdent(relType, 'relationship type');
    const tenantId = assertHomogenousTenant(
      relationships.map(r => r.tenantId),
      'batchUpsertRelationships',
    );

    const cypher = `
      UNWIND $rels AS rel
      WITH rel WHERE rel.tenantId = $tenantId
      MATCH (a:${safeFrom} {_tenantId: $tenantId, _id: rel.fromId})
      MATCH (b:${safeTo} {_tenantId: $tenantId, _id: rel.toId})
      MERGE (a)-[r:${safeRel}]->(b)
      SET r += rel.properties,
          r._syncedAt = datetime()
    `;

    const relData = relationships.map(r => ({
      tenantId: r.tenantId,
      fromId: r.fromId,
      toId: r.toId,
      properties: sanitizeProperties(r.properties ?? {}),
    }));

    await this.client.writeQuery(cypher, { tenantId, rels: relData });
    return relationships.length;
  }

  /**
   * Remove a node and all its relationships (soft delete sync)
   */
  async removeNode(label: string, tenantId: string, id: string): Promise<void> {
    const safeLabel = assertSafeIdent(label, 'label');
    const cypher = `
      MATCH (n:${safeLabel} {_tenantId: $tenantId, _id: $id})
      DETACH DELETE n
    `;

    await this.client.writeQuery(cypher, { tenantId, id });
  }

  /**
   * Remove a relationship
   */
  async removeRelationship(
    fromLabel: string,
    fromId: string,
    toLabel: string,
    toId: string,
    relType: string,
    tenantId: string
  ): Promise<void> {
    const safeFrom = assertSafeIdent(fromLabel, 'label');
    const safeTo = assertSafeIdent(toLabel, 'label');
    const safeRel = assertSafeIdent(relType, 'relationship type');
    const cypher = `
      MATCH (a:${safeFrom} {_tenantId: $tenantId, _id: $fromId})
            -[r:${safeRel}]->
            (b:${safeTo} {_tenantId: $tenantId, _id: $toId})
      DELETE r
    `;

    await this.client.writeQuery(cypher, { tenantId, fromId, toId });
  }

  /**
   * Process a domain event and sync to graph.
   * This is the primary integration point with the outbox pattern.
   */
  async processSyncEvent(event: SyncEvent): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      nodesCreated: 0,
      nodesUpdated: 0,
      relationshipsCreated: 0,
      relationshipsUpdated: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      const handler = EVENT_HANDLERS[event.eventType];
      if (handler) {
        await handler(this, event, result);
      } else {
        await this.handleGenericEvent(event, result);
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Generic event handler: upsert the entity as a node
   */
  private async handleGenericEvent(event: SyncEvent, result: SyncResult): Promise<void> {
    await this.upsertNode({
      label: event.entityType,
      id: event.entityId,
      tenantId: event.tenantId,
      properties: event.data,
    });
    result.nodesUpdated++;
  }

  /**
   * Get sync statistics for a tenant
   */
  async getSyncStats(tenantId: string): Promise<Record<string, number>> {
    const cypher = `
      MATCH (n {_tenantId: $tenantId})
      WITH labels(n) AS nodeLabels
      UNWIND nodeLabels AS label
      RETURN label, count(*) AS count
      ORDER BY count DESC
    `;

    const records = await this.client.readQuery<{ label: string; count: { low: number } }>(
      cypher,
      { tenantId }
    );

    const stats: Record<string, number> = {};
    for (const record of records) {
      stats[record.label] = typeof record.count === 'object' ? record.count.low : Number(record.count);
    }
    return stats;
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

type EventHandler = (engine: GraphSyncEngine, event: SyncEvent, result: SyncResult) => Promise<void>;

const EVENT_HANDLERS: Record<string, EventHandler> = {
  // Property events
  'property.created': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'Property',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: event.data,
    });
    result.nodesCreated++;
  },

  'property.updated': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'Property',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: event.data,
    });
    result.nodesUpdated++;
  },

  // Unit events
  'unit.created': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Unit',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.propertyId) {
      await engine.upsertRelationship({
        fromLabel: 'Property',
        fromId: String(data.propertyId),
        toLabel: 'Unit',
        toId: event.entityId,
        type: 'HAS_UNIT',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  // Lease events
  'lease.created': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Lease',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.unitId) {
      await engine.upsertRelationship({
        fromLabel: 'Lease',
        fromId: event.entityId,
        toLabel: 'Unit',
        toId: String(data.unitId),
        type: 'APPLIES_TO',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.customerId) {
      await engine.upsertRelationship({
        fromLabel: 'Customer',
        fromId: String(data.customerId),
        toLabel: 'Lease',
        toId: event.entityId,
        type: 'HAS_LEASE',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  'lease.activated': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'Lease',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: { ...event.data, status: 'active' },
    });
    result.nodesUpdated++;
  },

  'lease.terminated': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'Lease',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: { ...event.data, status: 'terminated' },
    });
    result.nodesUpdated++;
  },

  // Payment events
  'payment.succeeded': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Payment',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.invoiceId) {
      await engine.upsertRelationship({
        fromLabel: 'Payment',
        fromId: event.entityId,
        toLabel: 'Invoice',
        toId: String(data.invoiceId),
        type: 'PAYS',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  // Invoice events
  'invoice.created': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Invoice',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.customerId) {
      await engine.upsertRelationship({
        fromLabel: 'Invoice',
        fromId: event.entityId,
        toLabel: 'Customer',
        toId: String(data.customerId),
        type: 'BILLED_TO',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.leaseId) {
      await engine.upsertRelationship({
        fromLabel: 'Invoice',
        fromId: event.entityId,
        toLabel: 'Lease',
        toId: String(data.leaseId),
        type: 'FOR_LEASE',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  // Work order events
  'workorder.created': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'WorkOrder',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.unitId) {
      await engine.upsertRelationship({
        fromLabel: 'WorkOrder',
        fromId: event.entityId,
        toLabel: 'Unit',
        toId: String(data.unitId),
        type: 'TARGETS',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.vendorId) {
      await engine.upsertRelationship({
        fromLabel: 'WorkOrder',
        fromId: event.entityId,
        toLabel: 'Vendor',
        toId: String(data.vendorId),
        type: 'ASSIGNED_TO',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.maintenanceRequestId) {
      await engine.upsertRelationship({
        fromLabel: 'WorkOrder',
        fromId: event.entityId,
        toLabel: 'MaintenanceRequest',
        toId: String(data.maintenanceRequestId),
        type: 'CREATED_FROM',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  'workorder.completed': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'WorkOrder',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: { ...event.data, status: 'completed' },
    });
    result.nodesUpdated++;
  },

  // Maintenance request events
  'request.created': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'MaintenanceRequest',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.unitId) {
      await engine.upsertRelationship({
        fromLabel: 'MaintenanceRequest',
        fromId: event.entityId,
        toLabel: 'Unit',
        toId: String(data.unitId),
        type: 'ABOUT',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.reportedBy) {
      await engine.upsertRelationship({
        fromLabel: 'MaintenanceRequest',
        fromId: event.entityId,
        toLabel: 'Customer',
        toId: String(data.reportedBy),
        type: 'REPORTED_BY',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  // Case events
  'case.created': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Case',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.customerId) {
      await engine.upsertRelationship({
        fromLabel: 'Case',
        fromId: event.entityId,
        toLabel: 'Customer',
        toId: String(data.customerId),
        type: 'OPENED_BY',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.unitId) {
      await engine.upsertRelationship({
        fromLabel: 'Case',
        fromId: event.entityId,
        toLabel: 'Unit',
        toId: String(data.unitId),
        type: 'CASE_ABOUT',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.leaseId) {
      await engine.upsertRelationship({
        fromLabel: 'Case',
        fromId: event.entityId,
        toLabel: 'Lease',
        toId: String(data.leaseId),
        type: 'CASE_ABOUT',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  'case.escalated': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'Case',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: { ...event.data, status: 'escalated' },
    });
    result.nodesUpdated++;
  },

  // Notice events
  'notice.sent': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Notice',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.customerId) {
      await engine.upsertRelationship({
        fromLabel: 'Notice',
        fromId: event.entityId,
        toLabel: 'Customer',
        toId: String(data.customerId),
        type: 'SERVED_TO',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }

    if (data.caseId) {
      await engine.upsertRelationship({
        fromLabel: 'Notice',
        fromId: event.entityId,
        toLabel: 'Case',
        toId: String(data.caseId),
        type: 'ISSUED_FOR',
        tenantId: event.tenantId,
      });
      result.relationshipsCreated++;
    }
  },

  // Document events
  'document.uploaded': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Document',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesCreated++;

    if (data.associatedType && data.associatedId) {
      const targetLabel = mapAssociatedTypeToLabel(String(data.associatedType));
      if (targetLabel) {
        await engine.upsertRelationship({
          fromLabel: 'Document',
          fromId: event.entityId,
          toLabel: targetLabel,
          toId: String(data.associatedId),
          type: 'RELATES_TO',
          tenantId: event.tenantId,
        });
        result.relationshipsCreated++;
      }
    }
  },

  // Inspection events
  'inspection.completed': async (engine, event, result) => {
    const data = event.data;
    await engine.upsertNode({
      label: 'Inspection',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: data,
    });
    result.nodesUpdated++;
  },

  // Customer events
  'customer.created': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'Customer',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: event.data,
    });
    result.nodesCreated++;
  },

  // Vendor events
  'vendor.created': async (engine, event, result) => {
    await engine.upsertNode({
      label: 'Vendor',
      id: event.entityId,
      tenantId: event.tenantId,
      properties: event.data,
    });
    result.nodesCreated++;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sanitize properties for Neo4j (remove nulls, handle nested objects)
 */
function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('_')) continue;

    if (typeof value === 'object' && !Array.isArray(value) && value instanceof Date === false) {
      clean[key] = JSON.stringify(value);
    } else if (value instanceof Date) {
      clean[key] = value.toISOString();
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Map PostgreSQL associatedType to Neo4j label
 */
function mapAssociatedTypeToLabel(associatedType: string): string | null {
  const mapping: Record<string, string> = {
    lease: 'Lease',
    property: 'Property',
    unit: 'Unit',
    work_order: 'WorkOrder',
    case: 'Case',
    notice: 'Notice',
    payment: 'Payment',
    invoice: 'Invoice',
    inspection: 'Inspection',
    customer: 'Customer',
    vendor: 'Vendor',
  };
  return mapping[associatedType] ?? null;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createGraphSyncEngine(client: Neo4jClient): GraphSyncEngine {
  return new GraphSyncEngine(client);
}
