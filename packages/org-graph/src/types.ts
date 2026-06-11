/**
 * @borjie/org-graph — types.
 *
 * Public TypeScript types + Zod schemas for the org-graph layer.
 *
 * The org graph is the denormalised edges projection of existing
 * tenant tables (leases, organizations, payments, …) materialised
 * into `org_graph_edges` (migration 0222). It's traversed by recursive
 * CTEs in `traverse.ts` (max 3 hops by default) — the Executive Brief
 * Engine uses it to back claims with citations.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Edge types — open enumeration; the migration stores TEXT for forward-
// compat. Keep this list in sync with the migration comment block.
// ─────────────────────────────────────────────────────────────────────

export const EDGE_TYPES = [
  'leased_to',
  'managed_by',
  'reports_to',
  'paid_by',
  'tagged_with',
  'subdivides',
  'invoiced_for',
  'inspected_by',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const EdgeTypeSchema = z.enum(EDGE_TYPES);

// ─────────────────────────────────────────────────────────────────────
// MD-as-body edge + node vocabulary (ADDITIVE — does NOT touch the
// migration-bound `EDGE_TYPES` above; the `org_graph_edges` migration
// stores TEXT so these forward-compatible body edges persist without a
// schema change). The body schema is materialised by `@borjie/system-
// graph`, which composes on top of this org-graph layer.
//
// See Docs/research/MD_AS_BODY_ARCHITECTURE.md §bodyModel.
// ─────────────────────────────────────────────────────────────────────

/**
 * Body-schema edge types — how the MD's organs connect. Kept here (not
 * only in system-graph) so org-graph consumers can reason over a unified
 * edge vocabulary; system-graph re-exports + extends.
 */
export const BODY_EDGE_TYPES = [
  'renders_on',
  'depends_on',
  'flows_data_to',
  'governed_by',
  'measured_by',
  'mirrors',
  'exposes',
  'serves',
] as const;

export type BodyEdgeType = (typeof BODY_EDGE_TYPES)[number];

export const BodyEdgeTypeSchema = z.enum(BODY_EDGE_TYPES);

/** Body-schema node kinds (the MD's morphology). */
export const BODY_NODE_KINDS = [
  'org',
  'surface',
  'screen',
  'service',
  'package',
  'capability',
  'schema',
  'mcp',
  'junior',
] as const;

export type BodyNodeKind = (typeof BODY_NODE_KINDS)[number];

export const BodyNodeKindSchema = z.enum(BODY_NODE_KINDS);

// ─────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────

export const OrgGraphEdgeSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  srcEntityId: z.string().min(1),
  dstEntityId: z.string().min(1),
  edgeType: EdgeTypeSchema,
  weight: z.number().min(0),
  validFrom: z.date(),
  validTo: z.date().nullable(),
  evidenceRefs: z.array(z.string()),
  createdAt: z.date(),
});
export type OrgGraphEdge = z.infer<typeof OrgGraphEdgeSchema>;

export const OrgGraphNodeSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  displayName: z.string(),
});
export type OrgGraphNode = z.infer<typeof OrgGraphNodeSchema>;

/**
 * A traversal hop result. `depth` is the number of edges from the
 * starting entity; `path` is the list of (src→dst) edge ids walked.
 */
export const GraphHopSchema = z.object({
  entityId: z.string().min(1),
  depth: z.number().int().min(0),
  edgeType: EdgeTypeSchema.nullable(),
  path: z.array(z.string()).default([]),
});
export type GraphHop = z.infer<typeof GraphHopSchema>;

export const MaterializedPathSchema = z.object({
  fromEntityId: z.string().min(1),
  toEntityId: z.string().min(1),
  hops: z.array(GraphHopSchema),
  totalDepth: z.number().int().min(0),
});
export type MaterializedPath = z.infer<typeof MaterializedPathSchema>;

// ─────────────────────────────────────────────────────────────────────
// Source-projection signatures (consumed by projector.ts)
//
// Each projector source is a function that takes a tenant-scoped DB
// reader port and an outbox event payload and returns 0+ edge
// inserts. We deliberately keep these as plain shapes here (not
// dependent on Drizzle types) so the package can be tested with
// hand-built fixtures.
// ─────────────────────────────────────────────────────────────────────

export interface EdgeInsert {
  readonly id: string;
  readonly tenantId: string;
  readonly srcEntityId: string;
  readonly dstEntityId: string;
  readonly edgeType: EdgeType;
  readonly weight?: number;
  readonly validFrom?: Date;
  readonly validTo?: Date | null;
  readonly evidenceRefs?: ReadonlyArray<string>;
}

export interface EdgeUpdate {
  readonly id: string;
  readonly tenantId: string;
  readonly validTo: Date;
}

export interface OutboxEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}
