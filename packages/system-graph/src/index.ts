/**
 * @borjie/system-graph — the MD's LIVE, DERIVED body schema.
 *
 * The MD-as-body self-model. Walks routes / screens / package-exports /
 * db-schemas / MCP-tools / capability-registry / sub-MD registry to
 * regenerate a live graph of every surface + capability + dataflow, with
 * listChanged invalidation on deploy/migration/flag-flip.
 *
 * central-intelligence self-awareness reads this instead of the static
 * hand-written BRAIN_MODULES list (the in-repo drift cautionary case).
 *
 * Public surface:
 *   types   — node/edge vocabulary (additive over @borjie/org-graph),
 *             health (proprioception), graph + revision.
 *   builder — assemble + content-hash a graph; listChanged invalidation.
 *   derive  — pure per-substrate derivation sources.
 *   query   — MemGPT organ-map summary, query_body_schema(), blast radius.
 *   render  — the resident [BRAIN SELF-AWARENESS] prompt block.
 *   health  — observed-health overlay pass (injured-limb flagging).
 *
 * See Docs/research/MD_AS_BODY_ARCHITECTURE.md.
 */

export {
  NODE_KINDS,
  NodeKindSchema,
  BODY_LAYERS,
  BODY_EDGE_TYPES,
  BodyEdgeTypeSchema,
  SYSTEM_EDGE_TYPES,
  SystemEdgeTypeSchema,
  NODE_HEALTH_STATES,
  NodeHealthSchema,
  SystemNodeSchema,
  SystemEdgeSchema,
  SystemGraphSchema,
} from './types.js';

export type {
  NodeKind,
  BodyEdgeType,
  SystemEdgeType,
  NodeHealthState,
  NodeHealth,
  SystemNode,
  SystemEdge,
  SystemGraph,
  GraphFragment,
  DerivationSource,
  NodeCandidate,
  EdgeCandidate,
} from './types.js';

export {
  buildGraph,
  composeFragments,
  computeRevision,
  hasBodyChanged,
  type BuildGraphInput,
} from './builder.js';

export {
  deriveSelf,
  deriveRoutes,
  deriveScreens,
  derivePackages,
  deriveSchemas,
  deriveMcpTools,
  deriveCapabilities,
  deriveJuniors,
  systemNodeIds,
  type RouteManifestEntry,
  type ScreenManifestEntry,
  type PackageManifestEntry,
  type SchemaManifestEntry,
  type McpManifestEntry,
  type CapabilityManifestEntry,
  type JuniorManifestEntry,
} from './derive.js';

export {
  summariseOrganMap,
  queryBodySchema,
  blastRadius,
  DEFAULT_BLAST_DEPTH,
  MAX_BLAST_DEPTH,
  type OrganMapSummary,
  type BodySchemaQuery,
  type BodySchemaPage,
} from './query.js';

export {
  renderOrganMapBlock,
  describeBody,
} from './render.js';

export {
  attachHealth,
  type HealthReading,
} from './health.js';
