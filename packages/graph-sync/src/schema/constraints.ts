/**
 * Canonical Property Graph (CPG) — Neo4j Constraints & Indexes
 *
 * Enforces data integrity and optimizes query performance.
 * Run once during graph initialization, idempotent (IF NOT EXISTS).
 *
 * TENANT-ISOLATION EXCEPTION:
 *   The `CREATE CONSTRAINT`, `CREATE INDEX`, and `CREATE FULLTEXT INDEX`
 *   statements in this module operate on the GLOBAL schema namespace of
 *   the Neo4j database. They cannot — by design — carry a `$tenantId`
 *   parameter the way data-plane queries must. Every call site below is
 *   therefore routed through `Neo4jClient.runSchemaQuery`, which
 *   intentionally bypasses the tenant gate. DO NOT copy this pattern
 *   for any data-plane read/write.
 */

import type { Session } from 'neo4j-driver';
import type { Neo4jClient } from '../client/neo4j-client.js';

/**
 * Uniqueness constraints.
 * Ensures no duplicate nodes per tenant for core entities.
 * Composite constraint: (_tenantId, _id) must be unique per label.
 */
const UNIQUENESS_CONSTRAINTS: Array<{ label: string; properties: string[] }> = [
  // Organization & Governance
  { label: 'Org',              properties: ['_id'] },
  { label: 'Region',           properties: ['_tenantId', '_id'] },
  { label: 'Area',             properties: ['_tenantId', '_id'] },
  { label: 'Policy',           properties: ['_tenantId', '_id'] },
  { label: 'Role',             properties: ['_tenantId', '_id'] },
  { label: 'User',             properties: ['_tenantId', '_id'] },
  { label: 'Vendor',           properties: ['_tenantId', '_id'] },

  // Properties & Physical World
  { label: 'Property',         properties: ['_tenantId', '_id'] },
  { label: 'Building',         properties: ['_tenantId', '_id'] },
  { label: 'Block',            properties: ['_tenantId', '_id'] },
  { label: 'Floor',            properties: ['_tenantId', '_id'] },
  { label: 'Unit',             properties: ['_tenantId', '_id'] },
  { label: 'Space',            properties: ['_tenantId', '_id'] },
  { label: 'Asset',            properties: ['_tenantId', '_id'] },
  { label: 'Parcel',           properties: ['_tenantId', '_id'] },
  { label: 'SubParcel',        properties: ['_tenantId', '_id'] },
  { label: 'Improvement',      properties: ['_tenantId', '_id'] },

  // People
  { label: 'Person',           properties: ['_tenantId', '_id'] },
  { label: 'Household',        properties: ['_tenantId', '_id'] },
  { label: 'TenantProfile',    properties: ['_tenantId', '_id'] },
  { label: 'Customer',         properties: ['_tenantId', '_id'] },

  // Contracts & Documents
  { label: 'Lease',            properties: ['_tenantId', '_id'] },
  { label: 'LandLease',        properties: ['_tenantId', '_id'] },
  { label: 'ContractVersion',  properties: ['_tenantId', '_id'] },
  { label: 'Document',         properties: ['_tenantId', '_id'] },
  { label: 'Verification',     properties: ['_tenantId', '_id'] },

  // Operations
  { label: 'WorkOrder',        properties: ['_tenantId', '_id'] },
  { label: 'MaintenanceRequest', properties: ['_tenantId', '_id'] },
  { label: 'Inspection',       properties: ['_tenantId', '_id'] },
  { label: 'Issue',            properties: ['_tenantId', '_id'] },
  { label: 'Message',          properties: ['_tenantId', '_id'] },

  // Finance
  { label: 'Invoice',          properties: ['_tenantId', '_id'] },
  { label: 'Payment',          properties: ['_tenantId', '_id'] },
  { label: 'LedgerEntry',      properties: ['_tenantId', '_id'] },
  { label: 'PaymentPlan',      properties: ['_tenantId', '_id'] },
  { label: 'Concession',       properties: ['_tenantId', '_id'] },
  { label: 'Disbursement',     properties: ['_tenantId', '_id'] },

  // Legal
  { label: 'Case',             properties: ['_tenantId', '_id'] },
  { label: 'Notice',           properties: ['_tenantId', '_id'] },
  { label: 'EvidencePack',     properties: ['_tenantId', '_id'] },
  { label: 'CaseResolution',   properties: ['_tenantId', '_id'] },

  // Market
  { label: 'UtilityReading',   properties: ['_tenantId', '_id'] },
  { label: 'AnomalyEvent',     properties: ['_tenantId', '_id'] },

  // Timeline
  { label: 'TimelineEvent',    properties: ['_tenantId', '_id'] },
];

/**
 * Performance indexes for high-frequency lookups.
 */
const PERFORMANCE_INDEXES: Array<{ label: string; properties: string[]; name: string }> = [
  // Tenant isolation (every query starts here)
  { label: 'Property',  properties: ['_tenantId'],            name: 'idx_property_tenant' },
  { label: 'Unit',      properties: ['_tenantId'],            name: 'idx_unit_tenant' },
  { label: 'Customer',  properties: ['_tenantId'],            name: 'idx_customer_tenant' },

  // Property lookups
  { label: 'Unit',      properties: ['unitCode'],             name: 'idx_unit_code' },
  { label: 'Unit',      properties: ['status'],               name: 'idx_unit_status' },
  { label: 'Property',  properties: ['propertyCode'],         name: 'idx_property_code' },
  { label: 'Property',  properties: ['city'],                 name: 'idx_property_city' },
  { label: 'Property',  properties: ['status'],               name: 'idx_property_status' },

  // Operations lookups
  { label: 'WorkOrder',  properties: ['status'],              name: 'idx_wo_status' },
  { label: 'WorkOrder',  properties: ['priority'],            name: 'idx_wo_priority' },
  { label: 'MaintenanceRequest', properties: ['category'],    name: 'idx_maint_category' },
  { label: 'Inspection', properties: ['scheduledDate'],       name: 'idx_inspection_date' },

  // Finance lookups
  { label: 'Invoice',    properties: ['status'],              name: 'idx_invoice_status' },
  { label: 'Invoice',    properties: ['dueDate'],             name: 'idx_invoice_due' },
  { label: 'Payment',    properties: ['status'],              name: 'idx_payment_status' },
  { label: 'Payment',    properties: ['processedAt'],         name: 'idx_payment_date' },

  // Legal lookups
  { label: 'Case',       properties: ['status'],              name: 'idx_case_status' },
  { label: 'Case',       properties: ['caseType'],            name: 'idx_case_type' },
  { label: 'Case',       properties: ['severity'],            name: 'idx_case_severity' },
  { label: 'Notice',     properties: ['noticeType'],          name: 'idx_notice_type' },
  { label: 'Notice',     properties: ['status'],              name: 'idx_notice_status' },

  // People lookups
  { label: 'Customer',   properties: ['status'],              name: 'idx_customer_status' },
  { label: 'Customer',   properties: ['kycStatus'],           name: 'idx_customer_kyc' },
  { label: 'Lease',      properties: ['status'],              name: 'idx_lease_status' },
  { label: 'Lease',      properties: ['endDate'],             name: 'idx_lease_end' },

  // Timeline lookups
  { label: 'TimelineEvent', properties: ['timestamp'],        name: 'idx_timeline_ts' },
  { label: 'TimelineEvent', properties: ['eventType'],        name: 'idx_timeline_type' },

  // Asset lookups
  { label: 'Asset',      properties: ['assetType'],           name: 'idx_asset_type' },

  // Message lookups
  { label: 'Message',    properties: ['timestamp'],           name: 'idx_message_ts' },

  // Utility lookups
  { label: 'UtilityReading', properties: ['readingDate'],     name: 'idx_utility_date' },
];

/**
 * Full-text search indexes for natural language queries.
 */
const FULLTEXT_INDEXES: Array<{ name: string; labels: string[]; properties: string[] }> = [
  {
    name: 'ft_property_search',
    labels: ['Property'],
    properties: ['name', 'addressLine1', 'city', 'description'],
  },
  {
    name: 'ft_unit_search',
    labels: ['Unit'],
    properties: ['name', 'unitCode', 'description'],
  },
  {
    name: 'ft_customer_search',
    labels: ['Customer'],
    properties: ['firstName', 'lastName', 'email'],
  },
  {
    name: 'ft_case_search',
    labels: ['Case'],
    properties: ['title', 'description', 'caseNumber'],
  },
  {
    name: 'ft_workorder_search',
    labels: ['WorkOrder'],
    properties: ['title', 'description'],
  },
];

/**
 * Result shape returned by every schema-apply path.
 */
export interface ApplyConstraintsResult {
  constraintsCreated: number;
  indexesCreated: number;
  fulltextIndexesCreated: number;
  errors: string[];
}

/**
 * Minimal duck-typed interface for any client that can execute a raw
 * (parameter-less) schema DDL statement. Both `Neo4jClient` (via
 * `runSchemaQuery`) and a bare `Session` satisfy this — internally we
 * adapt them through small shims so the loop body stays identical.
 */
interface SchemaRunner {
  run(cypher: string): Promise<unknown>;
}

function adaptSession(session: Session): SchemaRunner {
  // SCHEMA-MGMT: admin-bootstrap, not tenant-scoped — DO NOT use for data-plane queries
  return { run: (cypher: string) => session.run(cypher) };
}

function adaptClient(client: Neo4jClient): SchemaRunner {
  // SCHEMA-MGMT: admin-bootstrap, not tenant-scoped — DO NOT use for data-plane queries
  return { run: (cypher: string) => client.runSchemaQuery(cypher) };
}

/**
 * Apply all constraints and indexes to the Neo4j database.
 * Idempotent — safe to run multiple times.
 *
 * Accepts either a {@link Neo4jClient} (preferred — routes through
 * `runSchemaQuery` so the tenant-isolation bypass is explicit) or a raw
 * `Session` (legacy back-compat for callers that still hold an open
 * session). New call sites SHOULD pass the client.
 */
export async function applyConstraintsAndIndexes(
  target: Neo4jClient | Session,
): Promise<ApplyConstraintsResult> {
  const runner: SchemaRunner = isNeo4jClient(target)
    ? adaptClient(target)
    : adaptSession(target);

  const result: ApplyConstraintsResult = {
    constraintsCreated: 0,
    indexesCreated: 0,
    fulltextIndexesCreated: 0,
    errors: [],
  };

  // Apply uniqueness constraints
  for (const { label, properties } of UNIQUENESS_CONSTRAINTS) {
    const propList = properties.map(p => `n.${p}`).join(', ');
    const constraintName = `uniq_${label.toLowerCase()}_${properties.join('_')}`;
    const cypher = `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${label}) REQUIRE (${propList}) IS UNIQUE`;

    try {
      // SCHEMA-MGMT: admin-bootstrap, not tenant-scoped — DO NOT use for data-plane queries
      await runner.run(cypher);
      result.constraintsCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Constraint ${constraintName}: ${msg}`);
    }
  }

  // Apply performance indexes
  for (const { label, properties, name } of PERFORMANCE_INDEXES) {
    const propList = properties.map(p => `n.${p}`).join(', ');
    const cypher = `CREATE INDEX ${name} IF NOT EXISTS FOR (n:${label}) ON (${propList})`;

    try {
      // SCHEMA-MGMT: admin-bootstrap, not tenant-scoped — DO NOT use for data-plane queries
      await runner.run(cypher);
      result.indexesCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Index ${name}: ${msg}`);
    }
  }

  // Apply full-text search indexes
  for (const { name, labels, properties } of FULLTEXT_INDEXES) {
    const labelList = labels.map(l => `\`${l}\``).join(', ');
    const propList = properties.map(p => `\`${p}\``).join(', ');
    const cypher = `CREATE FULLTEXT INDEX ${name} IF NOT EXISTS FOR (n:${labelList}) ON EACH [${propList.split(', ').map(p => `n.${p.replace(/`/g, '')}`).join(', ')}]`;

    try {
      // SCHEMA-MGMT: admin-bootstrap, not tenant-scoped — DO NOT use for data-plane queries
      await runner.run(cypher);
      result.fulltextIndexesCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fulltext index ${name}: ${msg}`);
    }
  }

  return result;
}

/**
 * Best-effort duck-type check that distinguishes a `Neo4jClient` from a
 * `Session`. Both expose a `run` method but only the client exposes
 * `runSchemaQuery` — that's the cheapest discriminator.
 */
function isNeo4jClient(target: Neo4jClient | Session): target is Neo4jClient {
  return typeof (target as Neo4jClient).runSchemaQuery === 'function';
}

export { UNIQUENESS_CONSTRAINTS, PERFORMANCE_INDEXES, FULLTEXT_INDEXES };
