# Knowledge Graph + GraphRAG + Graph Visualization — SOTA-2026 research notes

> Captured 2026-05-24 as the foundation for `@borjie/knowledge-graph`.
> Scope: knowledge-graph platforms, GraphRAG retrieval patterns,
> graph embeddings, graph visualization toolkits, real-estate
> ontologies, bi-temporal facts, and provenance — all with concrete
> citations.

## 1. Graph databases (LPG + RDF)

| Platform                | Model        | 2026 status                                                                                           |
|-------------------------|--------------|--------------------------------------------------------------------------------------------------------|
| **Neo4j 5.x**           | LPG          | Mature; Aura serverless; vector index built-in; openCypher-superset.                                   |
| **Memgraph 2.x**        | LPG          | Real-time stream-friendly; MAGE algorithm lib; Cypher; popular for fraud / observability.              |
| **NebulaGraph 3.8**     | LPG          | Distributed; nGQL + openCypher; strong on trillion-edge benchmarks.                                    |
| **KuzuDB 0.5**          | LPG embedded | Single-process, columnar storage, file-based; ideal for laptop-scale GraphRAG (SQLite-of-graph DBs).   |
| **FalkorDB**            | LPG          | Redis-Module fork of RedisGraph; cited as the lowest-latency GraphRAG store in 2026 benchmarks.        |
| **AnzoGraph**           | RDF + SPARQL | Massive-parallel quad store from Cambridge Semantics; enterprise analytics workloads.                  |
| **Stardog 10**          | RDF + SPARQL | Reasoning over SHACL + OWL; "knowledge fabric" positioning.                                            |
| **Oxigraph**            | RDF embedded | Rust-native SPARQL 1.1; tiny dependency footprint.                                                     |

### Cypher / Gremlin vs SPARQL

- **Cypher** (declarative, ASCII-art pattern syntax) — ratified in
  GQL ISO/IEC 39075:2024, accepted by Neo4j, Memgraph, KuzuDB,
  NebulaGraph, FalkorDB. Lowest learning curve, best LLM-text-to-
  query support in 2026.
- **Gremlin** (imperative traversal DSL) — TinkerPop standard;
  drives Amazon Neptune, JanusGraph. Less LLM-friendly.
- **SPARQL** (RDF query language) — required for ontology-heavy
  domains (life sciences, gov data). RDF* extends RDF with edge
  properties so SPARQL gains LPG-like ergonomics.

### LPG vs RDF / RDF*

- **LPG** stores edge properties natively; simpler model, better for
  operational graphs. Used here.
- **RDF triples** are universal interchange — every fact is
  `(subject, predicate, object)`. Excellent for federation across
  jurisdictions / vendors.
- **RDF\*** (also written RDF-star) extends RDF to put statements
  about statements (so an edge can carry properties like
  `validFrom`). W3C draft as of 2025.

For BORJIE we serialise LPG → RDF* for any cross-tenant
publication; tenants keep their native LPG.

## 2. Knowledge-graph ontology standards

- **schema.org** — broad-domain consumer-web vocab. We map
  `Property` ⇄ `schema:Residence`, `Tenant` ⇄ `schema:Person`,
  `Lease` ⇄ `schema:LeaseAction`. https://schema.org/
- **W3C OWL 2** — full description-logic ontology language; class
  hierarchies + property restrictions; reasoning by HermiT / Pellet.
  Heavyweight; we use only a subset.
- **W3C RDFS** — lightweight subset of OWL; `rdfs:subClassOf` +
  `rdfs:domain` / `rdfs:range` cover 90% of our needs.
- **W3C SHACL** — constraint language ("a `Lease` MUST have a
  `signedBy` link to a `Tenant`"). We adopt a SHACL-light syntax in
  `OntologyDef.properties` + `OntologyDef.edges`.
- **PROV-O** — W3C Provenance Ontology
  (https://www.w3.org/TR/prov-o/). Every fact in our KG carries a
  `ProvenanceRecord` with `wasGeneratedBy` / `wasDerivedFrom`
  semantics so we can answer "what document, on what date, with what
  AI model, produced this fact?"

## 3. Real-estate domain ontologies

| Ontology             | Maintainer                      | What it covers                                                                     |
|----------------------|---------------------------------|-------------------------------------------------------------------------------------|
| **BOT** (Building Topology Ontology) | W3C LBD CG       | Site / Building / Storey / Space hierarchy; minimal core for AEC.                  |
| **Brick Schema**     | https://brickschema.org/        | Sensors, equipment, points; used by Microsoft Smart Buildings + LBNL.              |
| **RealEstateCore**   | RealEstateCore Consortium       | Operational ontology for commercial property; aligns BOT + Brick + ISO 19650.      |
| **IFC** (Industry Foundation Classes) | buildingSMART | BIM authoring; very heavyweight; we ignore most of it.                            |
| **GeoSPARQL**        | OGC                             | Geometry literals + spatial relations (within / intersects / touches).             |

Our `realEstateOntology` is a 15-class compact distillation aligned
with BOT + RealEstateCore + GeoSPARQL. Tenants extend via
`extendOntology()`.

## 4. Graph embeddings (2026 SOTA)

| Method               | Origin                                | Use case                                                       |
|----------------------|----------------------------------------|-----------------------------------------------------------------|
| **GraphSAGE**        | Hamilton 2017 (NeurIPS)               | Inductive; samples 1-2 hop neighbourhood; very influential.    |
| **GAT**              | Veličković 2018 (ICLR)                | Attention over neighbours; great when neighbourhoods are noisy.|
| **R-GCN**            | Schlichtkrull 2018 (ESWC)             | Relational GCN for multi-edge-type KGs.                         |
| **TransE / ComplEx / RotatE / BoxE** | various                  | KG-completion (link prediction); embed entities + relations as |
|                      |                                        | translations / rotations / box queries. BoxE (2020) supports   |
|                      |                                        | first-order logic queries natively.                            |
| **GREASELM**         | Stanford 2022                          | KG-conditioned LM for QA; predates GraphRAG.                   |

Our v1 embedder is a **naive node-card + neighbours** strategy fed
to a text embedder. It is intentionally swappable — production can
substitute GraphSAGE or RGCN behind the same `KGEmbedderPort`.

## 5. GraphRAG patterns

- **Microsoft GraphRAG** — open-source pipeline (Apache-2.0,
  https://github.com/microsoft/graphrag): build LPG → run Leiden
  for hierarchical communities → LLM-summarise each level →
  answer queries against the community-summary index. Excels at
  "give me a holistic overview" questions where vector-RAG fails.
- **neo4j-graphrag-python** — official Neo4j GraphRAG package.
  Provides retrievers: vector, vector+Cypher, text2Cypher, hybrid.
  https://github.com/neo4j/neo4j-graphrag-python
- **LightRAG** — Tang et al. arXiv 2410.05779 (2025). Dual-level
  retrieval (low = local entities, high = global themes); cheaper
  than full GraphRAG.
- **HippoRAG** — Gutiérrez et al. NeurIPS 2024. Hippocampus-inspired
  Personalised PageRank over a KG; outperforms RAG on multi-hop QA.
- **Glean** — enterprise-grade hybrid GraphRAG product;
  proprietary; canonical example of "vector + identity + graph"
  for the workplace.
- **HuggingFace `langchain-graphrag`** — community port for the
  Microsoft pipeline.

Our `answerWithKG` implements the core pipeline (hybrid retrieval →
community summary → LLM answer) with `CitationPath` output so the
portal can render footnotes pointing to exact KG facts.

## 6. Graph visualization (2026 SOTA)

| Tool                      | Strength                                                            | Where we emit a spec |
|---------------------------|---------------------------------------------------------------------|-----------------------|
| **Cytoscape.js 3.x**      | Rich layouts, perfect for interactive bio/network science UIs.       | `cytoscapeSpec`       |
| **Sigma.js 3.x**          | WebGL renderer; handles 100k+ nodes; pairs with `graphology`.        | `sigmaSpec`           |
| **react-force-graph 1.x** | React wrapper around d3-force / 3d-force-graph; quick to integrate. | `forceGraphSpec`      |
| **3d-force-graph**        | Three.js variant of the above; immersive demos.                      | (reuses forceGraph spec) |
| **Reagraph 4.x**          | GPU-accelerated React component; great defaults.                     | (uses forceGraph spec) |
| **Linkurious**            | Commercial investigative graph UI (fraud / AML).                     | n/a (export-only)     |
| **Neo4j Bloom**           | Visual exploration UX shipped with Aura.                             | n/a (Neo4j-side)      |
| **Kepler.gl + deck.gl**   | Geospatial big-data viz; great for parcel + district overlays.       | future `geoSpec`      |
| **D3 chord / sankey / treemap** | Aggregate views — class-to-class flows, hierarchical.          | `chordSpec`, `sankeySpec`, `treeMapSpec` |

All 6 spec builders share a single deterministic colour palette
(`DEFAULT_CLASS_COLOURS`) so the UI stays visually consistent across
charts and the force graph.

## 7. Geospatial graph

- **GeoSPARQL 1.1** — OGC standard for geometry literals in RDF.
  Supports `geo:within`, `geo:intersects`, etc. We tag every
  `Parcel` node with WKT/GeoJSON so future Kepler.gl overlays can
  hydrate from the KG.
- **Kepler.gl + deck.gl** — Uber/Mapbox stack for client-side
  geospatial visualisation. We defer rendering to a future
  `geoSpec` builder; the data shape already lives in the ontology.

## 8. Bi-temporal facts

- **Snodgrass, "Developing Time-Oriented Database Applications in
  SQL", 1999** — original bi-temporal model: valid-time + tx-time.
- **TerminusDB** — modern bi-temporal RDF store with git-style
  branching.
- **Datomic** — bi-temporal LPG with `:db/txInstant` system attr.
- **XTDB v2** — open-source bi-temporal DB (formerly Crux).

Our `BiTemporalFact` adds `validFrom`, `validTo`, `recordedAt`,
`retractedAt` to every node/edge. `getStateAt(timestamp)` re-runs
predicates against the partition; `compareStates` diffs two
timestamps. This matches Snodgrass terminology so future SQL/RDF
backends can map 1:1.

## 9. Provenance

- **W3C PROV-O** (Recommendation 2013-04-30) —
  https://www.w3.org/TR/prov-o/. Three core classes: `prov:Entity`,
  `prov:Activity`, `prov:Agent`; key relations
  `prov:wasGeneratedBy`, `prov:wasDerivedFrom`, `prov:wasAttributedTo`.
- **C2PA** (Coalition for Content Provenance and Authenticity) —
  cryptographic manifest standard for media. We bind every KG fact
  back to its C2PA-signed source via `ProvenanceRecord.c2paSignatureId`.
- **Anthropic Citations** — bundle of source spans tied to LLM
  output. We bind via `ProvenanceRecord.citationBundleId` so the UI
  can show the LLM's source for any inferred fact.

## 10. Vector + graph hybrid

- **pgvector + ltree** — Postgres extensions; cheap MVP combo;
  ltree for hierarchical paths.
- **HippoRAG** — best paper showing why hybrid wins multi-hop QA.
- **neo4j-graphrag-python `HybridCypherRetriever`** — vector
  retrieval + a Cypher template; production-ready pattern.
- **OpenSearch + Neptune** — Amazon's recipe (KNN index for vectors,
  Neptune for the graph).

Our `findRelevant` is a simplified version: in-memory cosine over
node embeddings + BFS expansion. The port is identical to
HybridCypherRetriever so we can swap in production.

## 11. Time-aware KGs

- **t-RDF / temporal RDF** — academic line; see "Temporal RDF" by
  Gutierrez et al., ISWC 2007.
- **Bi-temporal LPG patterns** — Datomic, XTDB.
- **Allen's interval algebra (1983)** — 13 relations between
  intervals (`before`, `meets`, `overlaps`, ...). Required vocab
  for any temporal reasoning layer we add on top.

## 12. Cited sources (12+ confirmed)

1. Microsoft GraphRAG project — https://github.com/microsoft/graphrag
2. neo4j-graphrag-python — https://github.com/neo4j/neo4j-graphrag-python
3. LightRAG paper — Tang et al. arXiv 2410.05779 (2025)
4. HippoRAG — Gutiérrez et al., NeurIPS 2024
5. GraphSAGE — Hamilton, Ying, Leskovec, NeurIPS 2017
6. GAT — Veličković et al., ICLR 2018
7. R-GCN — Schlichtkrull et al., ESWC 2018
8. BoxE — Abboud et al., NeurIPS 2020
9. BOT (Building Topology Ontology) — W3C LBD CG, https://w3c-lbd-cg.github.io/bot/
10. RealEstateCore — https://www.realestatecore.io/
11. Brick Schema — https://brickschema.org/
12. W3C PROV-O — https://www.w3.org/TR/prov-o/
13. W3C SHACL — https://www.w3.org/TR/shacl/
14. GQL ISO/IEC 39075:2024 (Cypher standardisation)
15. KuzuDB project — https://kuzudb.com/
16. Cytoscape.js — https://js.cytoscape.org/
17. Sigma.js + graphology — https://www.sigmajs.org/
18. react-force-graph — https://github.com/vasturiano/react-force-graph
19. C2PA standard — https://c2pa.org/
20. Anthropic Citations API — Anthropic docs (2025)

## 13. Design decisions logged

1. **LPG over RDF for the core store.** RDF* is gainable later via
   serialiser; we avoid SPARQL ceremony in the hot path.
2. **Naive embeddings first.** A real GNN (GraphSAGE / RGCN) costs
   more than a 1-hop text-card embed yields at our current scale.
   The port is in place for the upgrade.
3. **Bi-temporal on every node + edge.** Retrofitting time-awareness
   later is hellish; we pay the storage tax now.
4. **PROV-O binding mandatory before publishing.** Tenant data
   without provenance is dark data; `validateProvenance({ strict:
   true })` blocks publish.
5. **Single colour palette.** Force graphs, chord diagrams,
   treemaps, and analytics charts all share `DEFAULT_CLASS_COLOURS`
   so users build the same visual map of the domain everywhere.
