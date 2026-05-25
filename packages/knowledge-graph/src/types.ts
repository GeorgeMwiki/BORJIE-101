/**
 * @borjie/knowledge-graph — public types.
 *
 * Pure contracts. No runtime, no I/O.
 *
 * Implements the SOTA-2026 Knowledge Graph + GraphRAG architecture
 * documented in `Docs/KNOWLEDGE_GRAPH_RESEARCH_2026-05-24.md`.
 *
 * Architectural references:
 *   - Microsoft GraphRAG (https://github.com/microsoft/graphrag) — community
 *     summarisation + LLM-backed Q&A over an LPG.
 *   - neo4j-graphrag-python — hybrid vector + graph retrieval pipeline.
 *   - HippoRAG (NeurIPS 2024) — hippocampus-inspired graph + vector RAG.
 *   - LightRAG (arXiv 2410.05779) — dual-level retrieval (low/high) for GraphRAG.
 *   - BOT (Building Topology Ontology — W3C) — site/building/storey/space hierarchy.
 *   - RealEstateCore — domain ontology used by Microsoft Smart Buildings.
 *   - PROV-O (W3C) — provenance for facts (`wasDerivedFrom`, `wasGeneratedBy`).
 *   - schema.org — broad-domain entity types (RealEstateAgent, Residence, etc).
 *
 * Naming convention:
 *   - `KGStorePort` — pluggable storage (in-memory / KuzuDB / Neo4j).
 *   - `KGEmbedderPort` — graph-aware text embedder.
 *   - `KGViewerSpec` — declarative spec for force-graph / Cytoscape / Sigma viz.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Core graph primitives. Labeled Property Graph (LPG) model — Cypher-
// compatible. RDF*/SPARQL adapters can serialise these into triples
// without losing fidelity.
// ─────────────────────────────────────────────────────────────────────

/** A graph node. Every node has a tenant_id; class is the ontology class. */
export interface Node {
  /** Stable identifier. UUID or human-readable slug. */
  readonly id: string;
  /** Ontology class name (e.g. `Property`, `Unit`, `Tenant`). */
  readonly class: string;
  /** Tenant scope. All queries must filter by this. */
  readonly tenantId: string;
  /** Free-form key/value bag. Persisted as node properties. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Optional bi-temporal facts. See `BiTemporalFact`. */
  readonly validFrom?: string;
  readonly validTo?: string;
  /** ISO timestamp of when this fact was recorded. */
  readonly recordedAt?: string;
  /** PROV-O — what derived this node. */
  readonly derivedFrom?: ProvenanceRecord;
}

export const NodeSchema = z.object({
  id: z.string().min(1),
  class: z.string().min(1),
  tenantId: z.string().min(1),
  properties: z.record(z.unknown()).readonly(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  recordedAt: z.string().optional(),
  derivedFrom: z.lazy(() => ProvenanceRecordSchema).optional(),
});

/** A graph edge. Directed. */
export interface Edge {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  /** Relationship label (e.g. `hasUnit`, `occupiedBy`, `signedLease`). */
  readonly label: string;
  readonly tenantId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly recordedAt?: string;
  readonly derivedFrom?: ProvenanceRecord;
}

export const EdgeSchema = z.object({
  id: z.string().min(1),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  label: z.string().min(1),
  tenantId: z.string().min(1),
  properties: z.record(z.unknown()).readonly(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  recordedAt: z.string().optional(),
  derivedFrom: z.lazy(() => ProvenanceRecordSchema).optional(),
});

/** An RDF-style triple. Subject/predicate/object. */
export interface Triple {
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly tenantId: string;
  readonly validFrom?: string;
  readonly validTo?: string;
}

export const TripleSchema = z.object({
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  objectId: z.string().min(1),
  tenantId: z.string().min(1),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});

/** A traversal path through the graph: alternating node/edge IDs. */
export interface Path {
  readonly nodeIds: ReadonlyArray<string>;
  readonly edgeIds: ReadonlyArray<string>;
  /** Hop count = `nodeIds.length - 1`. */
  readonly hops: number;
}

/** A subgraph — nodes + edges all from the same tenant. */
export interface Subgraph {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
  readonly tenantId: string;
}

// ─────────────────────────────────────────────────────────────────────
// Ontology — class + property definitions. SHACL-light style.
// ─────────────────────────────────────────────────────────────────────

export interface OntologyClass {
  readonly name: string;
  readonly aliasOf?: string;
  /** schema.org URL or W3C URI for alignment. */
  readonly canonicalUri?: string;
  /** Parent class name (single inheritance). */
  readonly parent?: string;
  readonly description: string;
}

export interface PropertyConstraint {
  readonly name: string;
  /** Class this property belongs to. */
  readonly onClass: string;
  /** Datatype hint — `string`, `number`, `boolean`, `date`, `iri`. */
  readonly datatype: 'string' | 'number' | 'boolean' | 'date' | 'iri';
  readonly required: boolean;
  readonly description: string;
}

export interface EdgeConstraint {
  /** Relationship label. */
  readonly label: string;
  readonly fromClass: string;
  readonly toClass: string;
  /** Cardinality on the source side. */
  readonly fromCardinality: 'one' | 'many';
  readonly toCardinality: 'one' | 'many';
  readonly description: string;
}

/** Alias for ergonomics — `Property` matches RDF/SHACL terminology. */
export type Property = PropertyConstraint;

/** A complete ontology definition. */
export interface OntologyDef {
  readonly name: string;
  readonly version: string;
  readonly classes: ReadonlyArray<OntologyClass>;
  readonly properties: ReadonlyArray<PropertyConstraint>;
  readonly edges: ReadonlyArray<EdgeConstraint>;
}

// ─────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────

/** Pattern-style query — subgraph matching. */
export interface GraphQuery {
  /** Match nodes by class (any-of). */
  readonly nodeClasses?: ReadonlyArray<string>;
  /** Match edges by label (any-of). */
  readonly edgeLabels?: ReadonlyArray<string>;
  /** Tenant scope is REQUIRED — the store will reject queries without it. */
  readonly tenantId: string;
  /** Property filters: `nodeProps.foo = 'bar'`. */
  readonly nodeProperties?: Readonly<Record<string, unknown>>;
  /** Max hops from any seed nodes. */
  readonly maxHops?: number;
  /** Seed node IDs (optional — undefined = scan all). */
  readonly seedNodeIds?: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Embeddings
// ─────────────────────────────────────────────────────────────────────

export interface EmbeddingVector {
  readonly nodeId: string;
  readonly tenantId: string;
  /** L2-normalised when produced via cosine-similarity workflows. */
  readonly vector: ReadonlyArray<number>;
  readonly dimension: number;
  /** Optional — community / cluster the embedding falls into. */
  readonly community?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Provenance (PROV-O binding)
// ─────────────────────────────────────────────────────────────────────

export interface ProvenanceRecord {
  /** PROV-O activity kind. */
  readonly activityKind:
    | 'ingest'
    | 'extract'
    | 'infer'
    | 'merge'
    | 'manual_edit'
    | 'import';
  /** Source URI / file path / document ID. */
  readonly sourceUri: string;
  /** Optional C2PA signature ID (from packages/document-studio/c2pa). */
  readonly c2paSignatureId?: string;
  /** Optional AI model that inferred the fact. */
  readonly aiModelId?: string;
  /** ISO timestamp of when the activity ran. */
  readonly capturedAt: string;
  /** Optional Anthropic Citations bundle ID. */
  readonly citationBundleId?: string;
}

export const ProvenanceRecordSchema = z.object({
  activityKind: z.enum([
    'ingest',
    'extract',
    'infer',
    'merge',
    'manual_edit',
    'import',
  ]),
  sourceUri: z.string().min(1),
  c2paSignatureId: z.string().optional(),
  aiModelId: z.string().optional(),
  capturedAt: z.string(),
  citationBundleId: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────
// Bi-temporal fact — every fact carries valid-time + transaction-time.
// ─────────────────────────────────────────────────────────────────────

export interface BiTemporalFact {
  /** When the fact is true in the real world. */
  readonly validFrom: string;
  readonly validTo: string | null;
  /** When we learned/recorded the fact. */
  readonly recordedAt: string;
  /** Optional — when the fact was retracted in our store. */
  readonly retractedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Ports — pluggable storage, embedding, and visualization.
// ─────────────────────────────────────────────────────────────────────

/** Storage port. Implementations: in-memory (default), KuzuDB, Neo4j. */
export interface KGStorePort {
  /** Insert or update a node. Tenant-scoped. */
  upsertNode(node: Node): Promise<void>;
  /** Insert or update an edge. Tenant-scoped. */
  upsertEdge(edge: Edge): Promise<void>;
  /** Look up a node by ID within a tenant. */
  getNode(args: {
    readonly tenantId: string;
    readonly id: string;
  }): Promise<Node | null>;
  /** Get all neighbors of a node (1-hop). */
  getNeighbors(args: {
    readonly tenantId: string;
    readonly nodeId: string;
    readonly edgeLabels?: ReadonlyArray<string>;
    readonly direction?: 'in' | 'out' | 'both';
  }): Promise<Subgraph>;
  /** Pattern match — returns a subgraph satisfying the query. */
  match(query: GraphQuery): Promise<Subgraph>;
  /** Optional Cypher query (Neo4j, Memgraph, KuzuDB). */
  cypher?(args: {
    readonly tenantId: string;
    readonly query: string;
    readonly params?: Readonly<Record<string, unknown>>;
  }): Promise<Subgraph>;
  /** Optional SPARQL query (RDF stores). */
  sparql?(args: {
    readonly tenantId: string;
    readonly query: string;
  }): Promise<ReadonlyArray<Triple>>;
  /** All nodes in tenant — for full scans / community detection. */
  allNodes(tenantId: string): Promise<ReadonlyArray<Node>>;
  /** All edges in tenant. */
  allEdges(tenantId: string): Promise<ReadonlyArray<Edge>>;
}

/** Embedder port. Embeds a node by combining its text with neighbors. */
export interface KGEmbedderPort {
  /** Embed a node — typically `node.properties.text` + neighbour text. */
  embedNode(args: {
    readonly node: Node;
    readonly neighbors: ReadonlyArray<Node>;
  }): Promise<EmbeddingVector>;
  /** Embed a subgraph — aggregate node embeddings (mean / max-pool). */
  embedSubgraph(subgraph: Subgraph): Promise<EmbeddingVector>;
  /** Vector dimensionality. */
  readonly dimension: number;
}

/** Visualization spec — what a renderer (force-graph / Cytoscape) consumes. */
export interface KGViewerSpec {
  /** Spec kind — picks the renderer. */
  readonly kind:
    | 'forceGraph'
    | 'cytoscape'
    | 'sigma'
    | 'chord'
    | 'sankey'
    | 'treeMap';
  /** Renderer-specific payload. */
  readonly payload: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Brain port (for GraphRAG community summary + answerWithKG).
// Kept minimal — production wires this to @borjie/central-intelligence.
// ─────────────────────────────────────────────────────────────────────

export interface KGBrainPort {
  /** Summarise a body of facts into a short paragraph. */
  summarize(args: {
    readonly prompt: string;
    readonly facts: ReadonlyArray<string>;
  }): Promise<string>;
  /** Answer a question given a set of citations. */
  answer(args: {
    readonly question: string;
    readonly context: ReadonlyArray<string>;
  }): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────
// GraphRAG result types
// ─────────────────────────────────────────────────────────────────────

export interface RankedSubgraph {
  readonly subgraph: Subgraph;
  /** Cosine-similarity score (0..1) against the query embedding. */
  readonly score: number;
  /** Seed node that produced this subgraph. */
  readonly seedNodeId: string;
}

export interface CommunitySummary {
  readonly communityId: string;
  readonly nodeIds: ReadonlyArray<string>;
  readonly summary: string;
  /** Top entities — for breadcrumb display. */
  readonly topClasses: ReadonlyArray<string>;
}

export interface CitationPath {
  readonly path: Path;
  readonly facts: ReadonlyArray<string>;
}

export interface AnswerWithKG {
  readonly question: string;
  readonly answer: string;
  readonly citationPaths: ReadonlyArray<CitationPath>;
  /** Communities consulted while producing the answer. */
  readonly communities: ReadonlyArray<CommunitySummary>;
}

// ─────────────────────────────────────────────────────────────────────
// Diff (temporal)
// ─────────────────────────────────────────────────────────────────────

export interface SubgraphDiff {
  readonly addedNodeIds: ReadonlyArray<string>;
  readonly removedNodeIds: ReadonlyArray<string>;
  readonly addedEdgeIds: ReadonlyArray<string>;
  readonly removedEdgeIds: ReadonlyArray<string>;
  readonly changedNodeIds: ReadonlyArray<string>;
}
