/**
 * Corpus + entity ingestion for the Postgres knowledge graph.
 *
 * Populates `kg_nodes` / `kg_edges` (migration 0298) from REAL existing rows —
 * NEVER fabricated data. Entity ingestion is driven by a single DECLARATIVE
 * `INGEST_SOURCE` registry (see below): adding a whole new domain to GraphRAG
 * is ONE registry entry, never new orchestration code. Each entry maps a live
 * mining table to a node kind + a label / entity-ref / props projection and an
 * optional set of edge projections (which reference OTHER registered node
 * kinds; the adapter drops any edge whose endpoint node is absent, so a
 * cross-domain edge is best-effort and self-healing).
 *
 *   ENTITIES (mirrored from the live mining tables, when they exist):
 *     - estate_groups          → node kind `estate_group`
 *     - estate_entities        → node kind `estate_entity`  (owns ← group;
 *                                parent/subsidiary edges between entities)
 *     - staff_members          → node kind `staff`          (manages edges)
 *     - procurement_vendors    → node kind `vendor`
 *     - mineral_chain_of_custody.parcel_id → node kind `ore_parcel`
 *                                (supplies provenance edges ← vendor)
 *     - licences               → node kind `licence`        (held-by ← company /
 *                                operating entity, when that node exists)
 *     - royalty_return_drafts  → node kind `royalty_return`
 *     - production_records     → node kind `production_record`
 *     - mining_tasks           → node kind `mining_task`
 *     - marketplace_listings   → node kind `marketplace_listing`
 *     - offtake_agreements     → node kind `offtake_agreement`
 *                                (for-listing → marketplace_listing)
 *
 *   CORPUS (links the graph to the existing pgvector corpus):
 *     - intelligence_corpus_chunks → node kind `corpus_chunk`. The chunk's
 *       PRECOMPUTED embedding is COPIED into kg_nodes.embedding via plain SQL
 *       (`SELECT embedding FROM intelligence_corpus_chunks`). NO new embedding
 *       is ever computed — there is no embedder call and no OpenAI/Cohere
 *       credential required. `mentions` edges connect a chunk to any entity
 *       whose label appears (case-insensitively) in the chunk text.
 *
 * IDEMPOTENT: node ids are deterministic slugs (`<kind>:<sourceId>`) and the
 * adapter upserts ON CONFLICT (tenant, kind, entity_ref) / (tenant, src, dst,
 * relation). Re-running ingestion converges — never duplicates.
 *
 * RESILIENT: every source table is probed via `information_schema` before it is
 * queried, so a DB missing any one of them simply contributes fewer nodes
 * (honest partial graph) rather than crashing.
 *
 * TENANT SCOPE: the caller MUST run this inside `withTenantContext(db, tenantId,
 * …)` so (a) the source reads are RLS-filtered to the tenant and (b) the writes
 * through the adapter satisfy the kg_nodes/kg_edges tenant policy. The corpus
 * read also includes `tenant_id IS NULL` global chunks (shared ground truth)
 * but writes those chunk nodes UNDER the calling tenant so they are reachable
 * in that tenant's graph.
 *
 * Companion to:
 *   - services/api-gateway/src/composition/knowledge-graph/postgres-kg-store.ts
 *   - services/api-gateway/src/routes/mining/knowledge-graph.hono.ts
 *   - services/api-gateway/src/workers/kg-sync.worker.ts (cadenced auto-ingest)
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Edge, KGStorePort, Node } from '@borjie/knowledge-graph';
import { createLogger } from '../../utils/logger.js';
import { createPostgresKgStore, type KgDbExec } from './postgres-kg-store.js';

const logger = createLogger('kg-ingest');

/** Per-run counters surfaced to the caller (route / cron). */
export interface KgIngestResult {
  readonly tenantId: string;
  readonly nodes: number;
  readonly edges: number;
  /** Source registry keys that were present and contributed rows. */
  readonly sources: ReadonlyArray<string>;
  /** Source tables that were absent on this DB (honest skip log). */
  readonly skipped: ReadonlyArray<string>;
}

const NODE_LIMIT = 2_000; // per source table, per tenant — keeps a run bounded.
const CHUNK_LIMIT = 1_000; // corpus chunks linked per run.

// ── helpers ─────────────────────────────────────────────────────────────────

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

/** Probe `information_schema` once per table so a missing table is a no-op. */
async function tableExists(db: KgDbExec, table: string): Promise<boolean> {
  const rows = extractRows<{ ok: boolean }>(
    await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ${table}
      ) AS ok
    `),
  );
  return rows[0]?.ok === true;
}

function nodeId(kind: string, ref: string): string {
  return `${kind}:${ref}`;
}

function entityNode(args: {
  readonly tenantId: string;
  readonly kind: string;
  readonly ref: string;
  readonly label: string;
  readonly props: Record<string, unknown>;
}): Node {
  return {
    id: nodeId(args.kind, args.ref),
    class: args.kind,
    tenantId: args.tenantId,
    properties: { ...args.props, label: args.label, entity_ref: args.ref },
  };
}

function relEdge(args: {
  readonly tenantId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly relation: string;
  readonly weight?: number;
}): Edge {
  return {
    id: `${args.fromId}|${args.relation}|${args.toId}`,
    fromId: args.fromId,
    toId: args.toId,
    label: args.relation,
    tenantId: args.tenantId,
    properties: args.weight !== undefined ? { weight: args.weight } : {},
  };
}

/** Best-effort upsert that logs+continues on a single bad row (FK race, etc.). */
async function tryUpsertNode(store: KGStorePort, node: Node): Promise<boolean> {
  try {
    await store.upsertNode(node);
    return true;
  } catch (err) {
    logger.warn({ err, id: node.id }, 'kg_ingest_node_skipped');
    return false;
  }
}

async function tryUpsertEdge(store: KGStorePort, edge: Edge): Promise<boolean> {
  try {
    await store.upsertEdge(edge);
    return true;
  } catch (err) {
    logger.warn({ err, id: edge.id }, 'kg_ingest_edge_skipped');
    return false;
  }
}

// ── declarative ingest-source registry ──────────────────────────────────────

interface Counts {
  nodes: number;
  edges: number;
}

/** A row read from a source table — snake_case columns as the DB returns them. */
type SourceRow = Record<string, unknown>;

/**
 * Declarative description of a single edge to mint from a source row. The
 * endpoints are EXPRESSED as `(kind, ref)` pairs resolved against the same
 * `<kind>:<ref>` slug convention every node uses, so an edge can point at ANY
 * registered node kind. A null `fromRef`/`toRef` (e.g. a NULL FK column) drops
 * the edge cleanly; the adapter additionally drops any edge whose endpoint node
 * was not ingested (honest, self-healing cross-domain links).
 */
interface EdgeMapper {
  readonly relation: string;
  /** Resolve the source endpoint `(kind, ref)` for a row. */
  readonly from: (row: SourceRow) => { kind: string; ref: string | null };
  /** Resolve the destination endpoint `(kind, ref)` for a row. */
  readonly to: (row: SourceRow) => { kind: string; ref: string | null };
}

/**
 * One declarative ingest source. Adding a domain to GraphRAG is adding one of
 * these to `INGEST_SOURCE` — no new orchestration code is ever required.
 */
interface IngestSource {
  /** Stable registry key surfaced in `sources` (e.g. 'estate_groups'). */
  readonly key: string;
  /** Physical table name (probed via information_schema before any read). */
  readonly table: string;
  /** Node kind minted for each row (e.g. 'licence'). */
  readonly nodeKind: string;
  /**
   * Column projection list — drives `SELECT <columns> FROM <table>`. Each entry
   * is `'col'` or `'expr AS alias'`. ALWAYS include a column/alias named `id`
   * (the entity ref) cast to text. Kept as raw identifiers (never user input).
   */
  readonly columns: ReadonlyArray<string>;
  /** Optional extra WHERE predicate (ANDed with the tenant predicate). */
  readonly where?: SQL;
  /** Optional `DISTINCT ON (...)` clause (trusted SQL, never user input). */
  readonly distinctOn?: SQL;
  /**
   * Optional `ORDER BY ...` clause (trusted SQL). REQUIRED when `distinctOn`
   * is set — Postgres needs the ORDER BY to lead with the distinct key.
   */
  readonly orderBy?: SQL;
  /** Human label for the node (falls back to the ref when empty). */
  readonly labelMapper: (row: SourceRow) => string;
  /** Stable entity ref (defaults to the row's `id` column). */
  readonly refMapper?: (row: SourceRow) => string | null;
  /** Extra node properties (label/entity_ref are added automatically). */
  readonly propsMapper?: (row: SourceRow) => Record<string, unknown>;
  /** Edges minted from each row (each independently best-effort). */
  readonly edgeMappers?: ReadonlyArray<EdgeMapper>;
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

/**
 * The single source of truth for entity ingestion. The 5 original hardcoded
 * tables PLUS the previously-invisible domains (licences, royalty, production,
 * tasks, marketplace, offtakes). To wire a new domain, append one entry — the
 * orchestrator loop, idempotency, probing and tenant-scoping all apply for free.
 */
const INGEST_SOURCE: ReadonlyArray<IngestSource> = [
  // ── estate (root holdings) ──────────────────────────────────────────────
  {
    key: 'estate_groups',
    table: 'estate_groups',
    nodeKind: 'estate_group',
    columns: ['id::text AS id', 'name', 'holding_type'],
    labelMapper: (r) => asText(r.name) ?? '',
    propsMapper: (r) => ({ holding_type: asText(r.holding_type) ?? undefined }),
  },
  {
    key: 'estate_entities',
    table: 'estate_entities',
    nodeKind: 'estate_entity',
    columns: [
      'id::text AS id',
      'name',
      'kind',
      'estate_group_id::text AS estate_group_id',
      'parent_entity_id::text AS parent_entity_id',
    ],
    labelMapper: (r) => asText(r.name) ?? '',
    propsMapper: (r) => ({ entity_kind: asText(r.kind) ?? undefined }),
    edgeMappers: [
      {
        relation: 'owns',
        from: (r) => ({ kind: 'estate_group', ref: asText(r.estate_group_id) }),
        to: (r) => ({ kind: 'estate_entity', ref: asText(r.id) }),
      },
      {
        relation: 'parent-of',
        from: (r) => ({
          kind: 'estate_entity',
          ref: asText(r.parent_entity_id),
        }),
        to: (r) => ({ kind: 'estate_entity', ref: asText(r.id) }),
      },
    ],
  },
  // ── workforce ───────────────────────────────────────────────────────────
  {
    key: 'staff_members',
    table: 'staff_members',
    nodeKind: 'staff',
    columns: [
      'id::text AS id',
      'full_name',
      'role',
      'manager_id::text AS manager_id',
    ],
    where: sql`status <> 'terminated'`,
    labelMapper: (r) => asText(r.full_name) ?? '',
    propsMapper: (r) => ({ role: asText(r.role) ?? undefined }),
    edgeMappers: [
      {
        relation: 'manages',
        from: (r) => ({ kind: 'staff', ref: asText(r.manager_id) }),
        to: (r) => ({ kind: 'staff', ref: asText(r.id) }),
      },
    ],
  },
  // ── procurement ─────────────────────────────────────────────────────────
  {
    key: 'procurement_vendors',
    table: 'procurement_vendors',
    nodeKind: 'vendor',
    columns: ['id::text AS id', 'company_name', 'country', 'kyc_status'],
    labelMapper: (r) => asText(r.company_name) ?? '',
    propsMapper: (r) => ({
      country: asText(r.country) ?? undefined,
      kyc_status: asText(r.kyc_status) ?? undefined,
    }),
  },
  // ── ore provenance (chain of custody) ───────────────────────────────────
  {
    key: 'mineral_chain_of_custody',
    table: 'mineral_chain_of_custody',
    nodeKind: 'ore_parcel',
    // Distinct parcels (latest custody row), plus a supplies edge ← vendor.
    columns: ['parcel_id::text AS id', 'location', 'to_party_id::text AS to_party_id'],
    distinctOn: sql`DISTINCT ON (parcel_id)`,
    orderBy: sql`ORDER BY parcel_id, happened_at DESC`,
    labelMapper: (r) => `Parcel ${asText(r.id) ?? ''}`.trim(),
    propsMapper: (r) =>
      asText(r.location) ? { location: asText(r.location) } : {},
    edgeMappers: [
      {
        relation: 'supplies',
        from: (r) => ({ kind: 'vendor', ref: asText(r.to_party_id) }),
        to: (r) => ({ kind: 'ore_parcel', ref: asText(r.id) }),
      },
    ],
  },
  // ── licences (sovereign mining rights) ──────────────────────────────────
  {
    key: 'licences',
    table: 'licences',
    nodeKind: 'licence',
    columns: [
      'id::text AS id',
      'number',
      'kind',
      'mineral',
      'status',
      'company_id::text AS company_id',
    ],
    labelMapper: (r) => asText(r.number) ?? asText(r.id) ?? '',
    propsMapper: (r) => ({
      licence_kind: asText(r.kind) ?? undefined,
      mineral: asText(r.mineral) ?? undefined,
      status: asText(r.status) ?? undefined,
    }),
    edgeMappers: [
      // Held by the operating company / estate entity, when that node exists.
      {
        relation: 'held-by',
        from: (r) => ({ kind: 'licence', ref: asText(r.id) }),
        to: (r) => ({ kind: 'estate_entity', ref: asText(r.company_id) }),
      },
    ],
  },
  // ── royalty returns (regulatory filings) ────────────────────────────────
  {
    key: 'royalty_return_drafts',
    table: 'royalty_return_drafts',
    nodeKind: 'royalty_return',
    columns: [
      'id::text AS id',
      'mineral',
      'status',
      'period_start::text AS period_start',
      'period_end::text AS period_end',
    ],
    labelMapper: (r) =>
      `Royalty ${asText(r.mineral) ?? ''} ${asText(r.period_start) ?? ''}`.trim(),
    propsMapper: (r) => ({
      mineral: asText(r.mineral) ?? undefined,
      status: asText(r.status) ?? undefined,
      period_start: asText(r.period_start) ?? undefined,
      period_end: asText(r.period_end) ?? undefined,
    }),
  },
  // ── production (ore output records) ─────────────────────────────────────
  {
    key: 'production_records',
    table: 'production_records',
    nodeKind: 'production_record',
    columns: [
      'id::text AS id',
      'kind',
      'mass_kg::text AS mass_kg',
      'site_id::text AS site_id',
    ],
    labelMapper: (r) =>
      `Production ${asText(r.kind) ?? ''} ${asText(r.mass_kg) ?? ''}kg`.trim(),
    propsMapper: (r) => ({
      record_kind: asText(r.kind) ?? undefined,
      mass_kg: asText(r.mass_kg) ?? undefined,
      site_id: asText(r.site_id) ?? undefined,
    }),
  },
  // ── tasks (operations workflow) ─────────────────────────────────────────
  {
    key: 'mining_tasks',
    table: 'mining_tasks',
    nodeKind: 'mining_task',
    columns: [
      'id::text AS id',
      'title_en',
      'title_sw',
      'status',
      'priority',
      'site_id::text AS site_id',
    ],
    labelMapper: (r) => asText(r.title_en) ?? asText(r.title_sw) ?? '',
    propsMapper: (r) => ({
      status: asText(r.status) ?? undefined,
      priority: asText(r.priority) ?? undefined,
      site_id: asText(r.site_id) ?? undefined,
    }),
  },
  // ── marketplace (listings) ──────────────────────────────────────────────
  {
    key: 'marketplace_listings',
    table: 'marketplace_listings',
    nodeKind: 'marketplace_listing',
    columns: ['id::text AS id', 'title', 'category', 'status'],
    labelMapper: (r) => asText(r.title) ?? '',
    propsMapper: (r) => ({
      category: asText(r.category) ?? undefined,
      status: asText(r.status) ?? undefined,
    }),
  },
  // ── off-take agreements (signed buyer contracts) ────────────────────────
  {
    key: 'offtake_agreements',
    table: 'offtake_agreements',
    nodeKind: 'offtake_agreement',
    columns: [
      'id::text AS id',
      'status',
      'listing_id::text AS listing_id',
      'buyer_id::text AS buyer_id',
    ],
    where: sql`deleted_at IS NULL`,
    labelMapper: (r) => `Off-take ${asText(r.id) ?? ''}`.trim(),
    propsMapper: (r) => ({
      status: asText(r.status) ?? undefined,
      buyer_id: asText(r.buyer_id) ?? undefined,
    }),
    edgeMappers: [
      {
        relation: 'for-listing',
        from: (r) => ({ kind: 'offtake_agreement', ref: asText(r.id) }),
        to: (r) => ({ kind: 'marketplace_listing', ref: asText(r.listing_id) }),
      },
    ],
  },
];

/** The registry, exported for the worker + tests (read-only). */
export { INGEST_SOURCE };
export type { IngestSource };

// ── registry-driven entity ingestion ────────────────────────────────────────

/** Strip `undefined` props so the persisted jsonb stays compact + explainable. */
function cleanProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Ingest ONE declarative source: probe → query (tenant-scoped) → upsert a node
 * per row → mint each declared edge. Pure registry interpretation — never any
 * per-domain branching. Returns the node/edge counts written.
 */
async function ingestSource(
  db: KgDbExec,
  store: KGStorePort,
  tenantId: string,
  source: IngestSource,
): Promise<Counts> {
  const counts: Counts = { nodes: 0, edges: 0 };
  if (!(await tableExists(db, source.table))) return counts;

  // Build the projection + table refs as raw (trusted, non-user) identifiers.
  const columnsSql = sql.raw(source.columns.join(', '));
  const tableSql = sql.raw(source.table);
  const distinct = source.distinctOn ?? sql``;
  const whereExtra = source.where ? sql`AND ${source.where}` : sql``;
  const orderBy = source.orderBy ?? sql``;

  const rows = extractRows<SourceRow>(
    await db.execute(sql`
      SELECT ${distinct} ${columnsSql}
        FROM ${tableSql}
       WHERE tenant_id = ${tenantId}
       ${whereExtra}
       ${orderBy}
       LIMIT ${NODE_LIMIT}
    `),
  );

  for (const row of rows) {
    const ref = source.refMapper ? source.refMapper(row) : asText(row.id);
    if (!ref) continue;
    const label = source.labelMapper(row) || ref;
    const props = cleanProps(source.propsMapper ? source.propsMapper(row) : {});
    const ok = await tryUpsertNode(
      store,
      entityNode({ tenantId, kind: source.nodeKind, ref, label, props }),
    );
    if (!ok) continue;
    counts.nodes += 1;

    for (const em of source.edgeMappers ?? []) {
      const from = em.from(row);
      const to = em.to(row);
      if (!from.ref || !to.ref) continue;
      const wrote = await tryUpsertEdge(
        store,
        relEdge({
          tenantId,
          fromId: nodeId(from.kind, from.ref),
          toId: nodeId(to.kind, to.ref),
          relation: em.relation,
        }),
      );
      if (wrote) counts.edges += 1;
    }
  }
  return counts;
}

// ── corpus ingestion (REUSES existing embeddings — no new embedder) ─────────

/**
 * Create a `corpus_chunk` node per chunk and COPY its precomputed embedding
 * directly in SQL (no model call). Then connect each chunk to any entity node
 * whose label is mentioned in the chunk text (`mentions` edge) so the GraphRAG
 * layer can hop chunk → entity → other chunks.
 *
 * The embedding copy is done with a single INSERT … SELECT that reads
 * `intelligence_corpus_chunks.embedding` and writes it into `kg_nodes.embedding`
 * — bypassing the adapter for the vector copy ONLY (the adapter's port has no
 * embedding write), while still honouring tenant RLS because the whole call
 * runs inside the tenant context. Node identity stays consistent with the
 * adapter's `<kind>:<ref>` slug + unique key.
 */
async function ingestCorpusChunks(
  db: KgDbExec,
  store: KGStorePort,
  tenantId: string,
  entityLabels: ReadonlyArray<{ id: string; label: string }>,
): Promise<Counts> {
  const counts: Counts = { nodes: 0, edges: 0 };
  if (!(await tableExists(db, 'intelligence_corpus_chunks'))) return counts;

  // Upsert chunk nodes AND copy the existing pgvector embedding in one shot.
  // Reads global (tenant_id IS NULL) + this tenant's private chunks; writes the
  // node under the CALLING tenant so it lives in that tenant's graph. The
  // `id`/`kind`/`entity_ref` mirror the adapter's slug convention + unique key.
  const insertRes = await db.execute(sql`
    INSERT INTO kg_nodes (id, tenant_id, kind, entity_ref, label, embedding, props, updated_at)
    SELECT
      'corpus_chunk:' || c.id,
      ${tenantId},
      'corpus_chunk',
      c.id,
      left(coalesce(c.section, c.source_file, c.id), 200),
      c.embedding,
      jsonb_build_object(
        'source_file', c.source_file,
        'section', c.section,
        'url', c.url,
        'language', c.language,
        'global', (c.tenant_id IS NULL)
      ),
      now()
      FROM intelligence_corpus_chunks c
     WHERE (c.tenant_id IS NULL OR c.tenant_id = ${tenantId})
     ORDER BY c.ingested_at DESC
     LIMIT ${CHUNK_LIMIT}
    ON CONFLICT (tenant_id, kind, entity_ref) DO UPDATE
      SET label = EXCLUDED.label,
          embedding = EXCLUDED.embedding,
          props = EXCLUDED.props,
          updated_at = now()
    RETURNING id, entity_ref
  `);
  const chunkRows = extractRows<{ id: string; entity_ref: string }>(insertRes);
  counts.nodes += chunkRows.length;

  if (chunkRows.length === 0 || entityLabels.length === 0) return counts;

  // `mentions` edges — chunk text contains an entity label (case-insensitive).
  // We pull the chunk text once and do the substring match in app code so the
  // edge carries a real, explainable basis (no fuzzy guessing).
  const chunkIds = chunkRows.map((r) => r.entity_ref);
  const textRows = extractRows<{ id: string; chunk_text: string }>(
    await db.execute(sql`
      SELECT id, text AS chunk_text
        FROM intelligence_corpus_chunks
       WHERE id = ANY(${chunkIds})
    `),
  );
  // Only consider entity labels long enough to avoid spurious matches.
  const labels = entityLabels.filter((e) => e.label && e.label.length >= 4);
  for (const t of textRows) {
    const hay = (t.chunk_text ?? '').toLowerCase();
    if (hay.length === 0) continue;
    for (const e of labels) {
      if (!hay.includes(e.label.toLowerCase())) continue;
      if (
        await tryUpsertEdge(
          store,
          relEdge({
            tenantId,
            fromId: nodeId('corpus_chunk', t.id),
            toId: e.id,
            relation: 'mentions',
          }),
        )
      ) {
        counts.edges += 1;
      }
    }
  }
  return counts;
}

// ── orchestrator ────────────────────────────────────────────────────────────

/**
 * Run a full idempotent ingestion pass for ONE tenant. The caller MUST already
 * be inside `withTenantContext(db, tenantId, (tx) => ingestKnowledgeGraph({ db:
 * tx, tenantId }))` so both the source reads and the kg writes are tenant-RLS
 * scoped. Returns per-run counts. Never throws on a missing source table — it
 * records it under `skipped`.
 */
export async function ingestKnowledgeGraph(args: {
  readonly db: KgDbExec;
  readonly tenantId: string;
}): Promise<KgIngestResult> {
  const { db, tenantId } = args;
  if (!tenantId) {
    throw new Error('ingestKnowledgeGraph: tenantId is required');
  }
  const store = createPostgresKgStore(db);
  const sources: string[] = [];
  const skipped: string[] = [];
  let nodes = 0;
  let edges = 0;

  // Generic, registry-driven entity pass. One loop covers every domain; adding
  // a domain never touches this code — it is one INGEST_SOURCE entry.
  for (const source of INGEST_SOURCE) {
    let counts: Counts;
    try {
      counts = await ingestSource(db, store, tenantId, source);
    } catch (err) {
      // A single source failing (schema drift, unexpected column) must not
      // abort the whole pass — degrade honestly and keep going.
      logger.warn(
        { err, source: source.key },
        'kg_ingest_source_failed',
      );
      skipped.push(source.table);
      continue;
    }
    if (counts.nodes > 0) sources.push(source.key);
    else skipped.push(source.table);
    nodes += counts.nodes;
    edges += counts.edges;
  }

  // Snapshot entity labels for the `mentions` linker (all non-chunk nodes).
  const entityNodes = (await store.allNodes(tenantId)).filter(
    (n) => n.class !== 'corpus_chunk',
  );
  const entityLabels = entityNodes.map((n) => ({
    id: n.id,
    label: typeof n.properties.label === 'string' ? n.properties.label : '',
  }));

  const corpus = await ingestCorpusChunks(db, store, tenantId, entityLabels);
  if (corpus.nodes > 0) sources.push('corpus_chunks');
  else skipped.push('intelligence_corpus_chunks');
  nodes += corpus.nodes;
  edges += corpus.edges;

  logger.info(
    { tenantId, nodes, edges, sources, skipped },
    'kg_ingest_complete',
  );
  return { tenantId, nodes, edges, sources, skipped };
}
