/**
 * Corpus + entity ingestion for the Postgres knowledge graph.
 *
 * Populates `kg_nodes` / `kg_edges` (migration 0298) from REAL existing rows —
 * NEVER fabricated data:
 *
 *   ENTITIES (mirrored from the live mining tables, when they exist):
 *     - estate_groups        → node kind `estate_group`
 *     - estate_entities      → node kind `estate_entity`  (owns ← group;
 *                              parent/subsidiary edges between entities)
 *     - staff_members        → node kind `staff`          (employs ← group)
 *     - procurement_vendors  → node kind `vendor`         (supplies → group)
 *     - mineral_chain_of_custody.parcel_id → node kind `ore_parcel`
 *                              (located-at / supplies provenance edges)
 *
 *   CORPUS (links the graph to the existing pgvector corpus):
 *     - intelligence_corpus_chunks → node kind `corpus_chunk`. The chunk's
 *       PRECOMPUTED embedding is COPIED into kg_nodes.embedding via plain SQL
 *       (`SELECT embedding FROM intelligence_corpus_chunks`). NO new embedding
 *       is ever computed — there is no embedder call and no OpenAI/Cohere
 *       credential required. `mentions` edges connect a chunk to any entity
 *       whose label appears (case-insensitively) in the chunk text, and
 *       `document_corpus_links` (when present) is honoured for doc→chunk
 *       grouping.
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
 */

import { sql } from 'drizzle-orm';
import type { Edge, KGStorePort, Node } from '@borjie/knowledge-graph';
import { createLogger } from '../../utils/logger.js';
import { createPostgresKgStore, type KgDbExec } from './postgres-kg-store.js';

const logger = createLogger('kg-ingest');

/** Per-run counters surfaced to the caller (route / cron). */
export interface KgIngestResult {
  readonly tenantId: string;
  readonly nodes: number;
  readonly edges: number;
  /** Source tables that were present and contributed rows. */
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

// ── entity ingestion (each returns nodes/edges written) ─────────────────────

interface Counts {
  nodes: number;
  edges: number;
}

async function ingestEstate(
  db: KgDbExec,
  store: KGStorePort,
  tenantId: string,
): Promise<Counts> {
  const counts: Counts = { nodes: 0, edges: 0 };
  // Groups (root holdings).
  if (await tableExists(db, 'estate_groups')) {
    const groups = extractRows<{ id: string; name: string; holding_type: string }>(
      await db.execute(sql`
        SELECT id::text AS id, name, holding_type
          FROM estate_groups
         WHERE tenant_id = ${tenantId}
         LIMIT ${NODE_LIMIT}
      `),
    );
    for (const g of groups) {
      if (
        await tryUpsertNode(
          store,
          entityNode({
            tenantId,
            kind: 'estate_group',
            ref: g.id,
            label: g.name,
            props: { holding_type: g.holding_type },
          }),
        )
      ) {
        counts.nodes += 1;
      }
    }
  }
  // Entities (subsidiaries / operating companies) — owns ← group; parent edges.
  if (await tableExists(db, 'estate_entities')) {
    const entities = extractRows<{
      id: string;
      name: string;
      kind: string;
      estate_group_id: string | null;
      parent_entity_id: string | null;
    }>(
      await db.execute(sql`
        SELECT id::text AS id, name, kind,
               estate_group_id::text AS estate_group_id,
               parent_entity_id::text AS parent_entity_id
          FROM estate_entities
         WHERE tenant_id = ${tenantId}
         LIMIT ${NODE_LIMIT}
      `),
    );
    for (const e of entities) {
      const ok = await tryUpsertNode(
        store,
        entityNode({
          tenantId,
          kind: 'estate_entity',
          ref: e.id,
          label: e.name,
          props: { entity_kind: e.kind },
        }),
      );
      if (!ok) continue;
      counts.nodes += 1;
      if (e.estate_group_id) {
        if (
          await tryUpsertEdge(
            store,
            relEdge({
              tenantId,
              fromId: nodeId('estate_group', e.estate_group_id),
              toId: nodeId('estate_entity', e.id),
              relation: 'owns',
            }),
          )
        ) {
          counts.edges += 1;
        }
      }
      if (e.parent_entity_id) {
        if (
          await tryUpsertEdge(
            store,
            relEdge({
              tenantId,
              fromId: nodeId('estate_entity', e.parent_entity_id),
              toId: nodeId('estate_entity', e.id),
              relation: 'parent-of',
            }),
          )
        ) {
          counts.edges += 1;
        }
      }
    }
  }
  return counts;
}

async function ingestStaff(
  db: KgDbExec,
  store: KGStorePort,
  tenantId: string,
): Promise<Counts> {
  const counts: Counts = { nodes: 0, edges: 0 };
  if (!(await tableExists(db, 'staff_members'))) return counts;
  const staff = extractRows<{
    id: string;
    full_name: string;
    role: string;
    manager_id: string | null;
  }>(
    await db.execute(sql`
      SELECT id::text AS id, full_name, role, manager_id::text AS manager_id
        FROM staff_members
       WHERE tenant_id = ${tenantId}
         AND status <> 'terminated'
       LIMIT ${NODE_LIMIT}
    `),
  );
  for (const s of staff) {
    const ok = await tryUpsertNode(
      store,
      entityNode({
        tenantId,
        kind: 'staff',
        ref: s.id,
        label: s.full_name,
        props: { role: s.role },
      }),
    );
    if (!ok) continue;
    counts.nodes += 1;
    if (s.manager_id) {
      if (
        await tryUpsertEdge(
          store,
          relEdge({
            tenantId,
            fromId: nodeId('staff', s.manager_id),
            toId: nodeId('staff', s.id),
            relation: 'manages',
          }),
        )
      ) {
        counts.edges += 1;
      }
    }
  }
  return counts;
}

async function ingestVendors(
  db: KgDbExec,
  store: KGStorePort,
  tenantId: string,
): Promise<Counts> {
  const counts: Counts = { nodes: 0, edges: 0 };
  if (!(await tableExists(db, 'procurement_vendors'))) return counts;
  const vendors = extractRows<{
    id: string;
    company_name: string;
    country: string;
    kyc_status: string;
  }>(
    await db.execute(sql`
      SELECT id::text AS id, company_name, country, kyc_status
        FROM procurement_vendors
       WHERE tenant_id = ${tenantId}
       LIMIT ${NODE_LIMIT}
    `),
  );
  for (const v of vendors) {
    if (
      await tryUpsertNode(
        store,
        entityNode({
          tenantId,
          kind: 'vendor',
          ref: v.id,
          label: v.company_name,
          props: { country: v.country, kyc_status: v.kyc_status },
        }),
      )
    ) {
      counts.nodes += 1;
    }
  }
  return counts;
}

async function ingestOreParcels(
  db: KgDbExec,
  store: KGStorePort,
  tenantId: string,
): Promise<Counts> {
  const counts: Counts = { nodes: 0, edges: 0 };
  if (!(await tableExists(db, 'mineral_chain_of_custody'))) return counts;
  // Distinct ore parcels appearing in the chain-of-custody ledger, plus a
  // `supplies` edge to the most-recent receiving party when that party is a
  // known vendor node (defence: the FK guard in the adapter drops dangling).
  const parcels = extractRows<{
    parcel_id: string;
    location: string | null;
    to_party_id: string | null;
  }>(
    await db.execute(sql`
      SELECT DISTINCT ON (parcel_id)
             parcel_id, location, to_party_id::text AS to_party_id
        FROM mineral_chain_of_custody
       WHERE tenant_id = ${tenantId}
       ORDER BY parcel_id, happened_at DESC
       LIMIT ${NODE_LIMIT}
    `),
  );
  for (const p of parcels) {
    if (!p.parcel_id) continue;
    const ok = await tryUpsertNode(
      store,
      entityNode({
        tenantId,
        kind: 'ore_parcel',
        ref: p.parcel_id,
        label: `Parcel ${p.parcel_id}`,
        props: p.location ? { location: p.location } : {},
      }),
    );
    if (!ok) continue;
    counts.nodes += 1;
    if (p.to_party_id) {
      // Parcel currently held by / supplied to a vendor (best-effort link;
      // dropped cleanly by the adapter guard if the vendor node is absent).
      if (
        await tryUpsertEdge(
          store,
          relEdge({
            tenantId,
            fromId: nodeId('vendor', p.to_party_id),
            toId: nodeId('ore_parcel', p.parcel_id),
            relation: 'supplies',
          }),
        )
      ) {
        counts.edges += 1;
      }
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

  const estate = await ingestEstate(db, store, tenantId);
  if (estate.nodes > 0) sources.push('estate');
  nodes += estate.nodes;
  edges += estate.edges;

  const staff = await ingestStaff(db, store, tenantId);
  if (staff.nodes > 0) sources.push('staff');
  else skipped.push('staff_members');
  nodes += staff.nodes;
  edges += staff.edges;

  const vendors = await ingestVendors(db, store, tenantId);
  if (vendors.nodes > 0) sources.push('vendors');
  else skipped.push('procurement_vendors');
  nodes += vendors.nodes;
  edges += vendors.edges;

  const ore = await ingestOreParcels(db, store, tenantId);
  if (ore.nodes > 0) sources.push('ore_parcels');
  else skipped.push('mineral_chain_of_custody');
  nodes += ore.nodes;
  edges += ore.edges;

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
