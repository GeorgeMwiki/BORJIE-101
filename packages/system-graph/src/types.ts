/**
 * @borjie/system-graph — types.
 *
 * The MD's BODY SCHEMA — a LIVE, DERIVED self-model. Never hand-authored
 * (Anthropic introspection research: ground self-knowledge in an external
 * inspectable artifact, never introspect from weights). This is the layered
 * KG over the existing substrates:
 *
 *   LAYER 0 = Borjie-the-OS (the self).
 *   LAYER 1 = sub-MDs / juniors.
 *   LAYERS 2-4 = surfaces -> screens -> capabilities -> data-flows.
 *
 * NODE TYPES and EDGE TYPES here EXTEND the lease/property edges in
 * `@borjie/org-graph` additively — we re-export its EDGE_TYPES and add the
 * body-schema layer on top. The static `BRAIN_MODULES` list in
 * central-intelligence/self-awareness.ts is killed in favour of reading
 * this derived graph.
 *
 * See Docs/research/MD_AS_BODY_ARCHITECTURE.md §bodyModel.
 */

import { z } from 'zod';
import { EDGE_TYPES as ORG_EDGE_TYPES } from '@borjie/org-graph';

// ─────────────────────────────────────────────────────────────────────
// Body-schema node types — the morphology of the MD's body.
//
// `surface` (apps + portals), `screen`/`tab`, `service`, `package`,
// `capability`, `schema` (db table), `mcp` (mcp-server / tool), `junior`
// (sub-MD), `org` (LAYER 0, the self).
// ─────────────────────────────────────────────────────────────────────

export const NODE_KINDS = [
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

export type NodeKind = (typeof NODE_KINDS)[number];

export const NodeKindSchema = z.enum(NODE_KINDS);

/**
 * Body-layer index (0-4). Used by paging — the MemGPT organ-map summary
 * keeps the upper layers resident; lower layers page in on demand.
 */
export const BODY_LAYERS = {
  org: 0,
  junior: 1,
  surface: 2,
  service: 2,
  package: 2,
  mcp: 2,
  screen: 3,
  schema: 3,
  capability: 4,
} as const satisfies Record<NodeKind, number>;

// ─────────────────────────────────────────────────────────────────────
// Body-schema edge types — ADDITIVE over org-graph's lease/property
// edges. These describe how the body's organs connect.
//
//   renders_on   — a screen/capability renders on a surface
//   depends_on    — a package/service depends on another
//   flows_data_to — a dataflow edge (schema -> service -> surface)
//   governed_by   — a capability is governed by a rail/gate
//   measured_by   — a capability/node is measured by an observability axis
//   mirrors       — Borjie<->BN parity edge (registry "mirrors BN")
//   exposes       — a service exposes an mcp tool / a surface exposes a screen
//   serves        — a service serves a capability / a junior serves a capability
// ─────────────────────────────────────────────────────────────────────

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

/**
 * The full edge vocabulary the body graph understands — the org-graph
 * lease/property edges PLUS the body-schema edges. Additive union; the
 * org edges are preserved verbatim so org-graph traversal still works.
 */
export const SYSTEM_EDGE_TYPES = [
  ...ORG_EDGE_TYPES,
  ...BODY_EDGE_TYPES,
] as const;

export type SystemEdgeType = (typeof SYSTEM_EDGE_TYPES)[number];

export const SystemEdgeTypeSchema = z.enum(SYSTEM_EDGE_TYPES);

// ─────────────────────────────────────────────────────────────────────
// Node health (the proprioception / injured-limb layer).
//
// Each node optionally carries observed health. A 500-ing route or a
// sub-threshold capability is an INJURED LIMB (Lipson damage-detection)
// the MD routes around and flags. Health is OBSERVED, never self-reported
// — competence/calibration are computed from outcomes (Ackerman), not
// verbal claims.
// ─────────────────────────────────────────────────────────────────────

export const NODE_HEALTH_STATES = ['healthy', 'degraded', 'injured', 'unknown'] as const;
export type NodeHealthState = (typeof NODE_HEALTH_STATES)[number];

export const NodeHealthSchema = z.object({
  state: z.enum(NODE_HEALTH_STATES),
  /** Observed competence in [0,1] over the most recent measurement window. */
  competence: z.number().min(0).max(1).nullable(),
  /** Calibration error in [0,1]; lower is better. */
  calibrationError: z.number().min(0).max(1).nullable(),
  /** Free-form provenance for the health reading (e.g. "otel:5xx-rate"). */
  source: z.string(),
});
export type NodeHealth = z.infer<typeof NodeHealthSchema>;

// ─────────────────────────────────────────────────────────────────────
// Node + edge records.
// ─────────────────────────────────────────────────────────────────────

export const SystemNodeSchema = z.object({
  /** Stable id, e.g. `surface:owner-web`, `capability:offtake-settlement`. */
  id: z.string().min(1),
  kind: NodeKindSchema,
  /** Human label for prompt rendering. */
  label: z.string().min(1),
  /** Body layer index (0-4), derived from kind. */
  layer: z.number().int().min(0).max(4),
  /** One-line "what is this organ" summary for the LLM. */
  summary: z.string(),
  /** Provenance of the derivation source (e.g. `routes`, `schemas`). */
  derivedFrom: z.string().min(1),
  /** Optional observed health (proprioception). */
  health: NodeHealthSchema.nullable(),
});
export type SystemNode = z.infer<typeof SystemNodeSchema>;

export const SystemEdgeSchema = z.object({
  srcId: z.string().min(1),
  dstId: z.string().min(1),
  edgeType: SystemEdgeTypeSchema,
  /** Optional weight; defaults to 1 for body edges. */
  weight: z.number().min(0).default(1),
});
export type SystemEdge = z.infer<typeof SystemEdgeSchema>;

// ─────────────────────────────────────────────────────────────────────
// The graph + its content-addressed revision (listChanged invalidation).
//
// `revision` is a stable content hash of the derived graph. A
// deploy/migration/flag-flip that changes the body fires a `listChanged`
// signal = a new revision. Consumers (self-awareness, query_body_schema)
// compare revisions to know when to repage.
// ─────────────────────────────────────────────────────────────────────

export const SystemGraphSchema = z.object({
  /** Content-addressed revision of this graph (sha-256 hex). */
  revision: z.string().min(1),
  /** ISO timestamp the derivation ran. */
  derivedAt: z.string().min(1),
  nodes: z.array(SystemNodeSchema),
  edges: z.array(SystemEdgeSchema),
});
export type SystemGraph = z.infer<typeof SystemGraphSchema>;

// ─────────────────────────────────────────────────────────────────────
// Derivation source — a pure function that contributes nodes + edges.
//
// Each source walks one substrate (route manifests, screen registries,
// package exports, Drizzle schemas, MCP discovery, capability registry)
// and returns a fragment. Sources are pure over their INPUT so the
// package tests with hand-built fixtures and never touches the FS or DB.
// The concrete FS/DB walkers live in services/consolidation-worker.
// ─────────────────────────────────────────────────────────────────────

export interface GraphFragment {
  readonly nodes: ReadonlyArray<NodeCandidate>;
  readonly edges: ReadonlyArray<EdgeCandidate>;
}

export interface DerivationSource<Input> {
  /** Stable id, e.g. `routes`, `screens`, `schemas`. */
  readonly id: string;
  /** Pure derivation: input -> graph fragment. */
  readonly derive: (input: Input) => GraphFragment;
}

/**
 * A raw, pre-validated node/edge candidate the FS/DB walkers emit. The
 * builder validates + normalises these (fills layer, defaults health).
 */
export interface NodeCandidate {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly summary?: string;
  readonly derivedFrom: string;
  readonly health?: NodeHealth | null;
}

export interface EdgeCandidate {
  readonly srcId: string;
  readonly dstId: string;
  readonly edgeType: SystemEdgeType;
  readonly weight?: number;
}
