/**
 * Unit tests for the registry-driven knowledge-graph ingest (W2d).
 *
 * Proves the DECLARATIVE `INGEST_SOURCE` registry — not hardcoded if-blocks —
 * drives ingestion:
 *
 *   1. The registry contains the original 5 sources PLUS the previously-dark
 *      domains (licences, royalty, production, tasks, marketplace, off-takes),
 *      so adding a domain is one entry, never new code.
 *   2. A seeded domain row (a `licences` row) flows through the generic
 *      orchestrator and emits a `licence` node via the store — purely from its
 *      registry entry, with no per-domain branch.
 *   3. A declared cross-domain edge mapper is honoured (off-take → listing).
 *
 * The DB is stubbed over the `KgDbExec` seam; the store is stubbed so we can
 * assert exactly which nodes/edges the registry produced for the seeded rows.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Edge, KGStorePort, Node } from '@borjie/knowledge-graph';

import { INGEST_SOURCE, ingestKnowledgeGraph } from '../ingest.js';
import type { KgDbExec } from '../postgres-kg-store.js';

const TENANT = 'tenant-w2d';

/** Serialize a drizzle SQL object to plain text for table-name matching. */
function sqlText(q: unknown): string {
  return JSON.stringify(q);
}

/**
 * Build a stub `KgDbExec` that:
 *   - answers every `information_schema` probe for a table named in `present`
 *     with `{ ok: true }` (others `{ ok: false }`),
 *   - returns `rowsByTable[table]` for the registry SELECT against that table,
 *   - returns [] for everything else (corpus insert, mentions text scan, …).
 */
function makeStubDb(args: {
  present: ReadonlyArray<string>;
  rowsByTable: Record<string, ReadonlyArray<Record<string, unknown>>>;
}): KgDbExec {
  return {
    execute: vi.fn(async (q: unknown) => {
      const text = sqlText(q);
      // information_schema existence probe — the table name is a bound param.
      if (text.includes('information_schema.tables')) {
        const ok = args.present.some((t) => text.includes(`"${t}"`) || text.includes(t));
        return [{ ok }];
      }
      // Registry SELECT — `FROM <table>` is a raw chunk in the serialized SQL.
      for (const [table, rows] of Object.entries(args.rowsByTable)) {
        if (text.includes(table) && text.toLowerCase().includes('from')) {
          return rows;
        }
      }
      return [];
    }),
  };
}

/** In-memory KGStorePort double recording every upsert. */
function makeStubStore(): {
  store: KGStorePort;
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const store: KGStorePort = {
    upsertNode: vi.fn(async (n: Node) => {
      nodes.push(n);
    }),
    upsertEdge: vi.fn(async (e: Edge) => {
      // Mirror the real adapter's endpoint guard: only keep an edge whose
      // endpoints were both ingested as nodes.
      const known = new Set(nodes.map((n) => n.id));
      if (!known.has(e.fromId) || !known.has(e.toId)) {
        throw new Error('both endpoints must exist');
      }
      edges.push(e);
    }),
    getNode: vi.fn(async () => null),
    getNeighbors: vi.fn(async () => ({ nodes: [], edges: [], tenantId: TENANT })),
    match: vi.fn(async () => ({ nodes: [], edges: [], tenantId: TENANT })),
    allNodes: vi.fn(async () => nodes),
    allEdges: vi.fn(async () => edges),
  };
  return { store, nodes, edges };
}

// The store factory the ingest module pulls in is replaced so our double is
// used for the upsert assertions. The mock factory is hoisted above the module
// body, so it reads the current store off `globalThis` (set per test) rather
// than an outer `let` it could not legally capture.
vi.mock('../postgres-kg-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../postgres-kg-store.js')>();
  return {
    ...actual,
    createPostgresKgStore: () => globalThis.__kgIngestStore,
  };
});

declare global {
  // eslint-disable-next-line no-var
  var __kgIngestStore: KGStorePort;
}

describe('INGEST_SOURCE registry', () => {
  it('is declarative: contains the original 5 + the new domains', () => {
    const keys = INGEST_SOURCE.map((s) => s.key);
    // Original 5.
    for (const k of [
      'estate_groups',
      'estate_entities',
      'staff_members',
      'procurement_vendors',
      'mineral_chain_of_custody',
    ]) {
      expect(keys).toContain(k);
    }
    // Previously-dark domains now wired generatively.
    for (const k of [
      'licences',
      'royalty_return_drafts',
      'production_records',
      'mining_tasks',
      'marketplace_listings',
      'offtake_agreements',
    ]) {
      expect(keys).toContain(k);
    }
    // Every entry has the declarative shape (no per-domain code path).
    for (const s of INGEST_SOURCE) {
      expect(typeof s.table).toBe('string');
      expect(typeof s.nodeKind).toBe('string');
      expect(Array.isArray(s.columns)).toBe(true);
      expect(typeof s.labelMapper).toBe('function');
    }
  });
});

describe('ingestKnowledgeGraph (registry-driven)', () => {
  it('emits a node for a seeded domain row (licences) with no per-domain code', async () => {
    const stub = makeStubStore();
    globalThis.__kgIngestStore = stub.store;
    const db = makeStubDb({
      present: ['licences'],
      rowsByTable: {
        licences: [
          {
            id: 'lic-1',
            number: 'PML-0001',
            kind: 'PML',
            mineral: 'gold',
            status: 'active',
            company_id: null,
          },
        ],
      },
    });

    const result = await ingestKnowledgeGraph({ db, tenantId: TENANT });

    // The seeded licence produced exactly one `licence` node, sourced from the
    // registry entry alone.
    const licenceNodes = stub.nodes.filter((n) => n.class === 'licence');
    expect(licenceNodes).toHaveLength(1);
    expect(licenceNodes[0]?.id).toBe('licence:lic-1');
    expect(licenceNodes[0]?.tenantId).toBe(TENANT);
    expect(licenceNodes[0]?.properties.label).toBe('PML-0001');
    expect(licenceNodes[0]?.properties.mineral).toBe('gold');

    expect(result.tenantId).toBe(TENANT);
    expect(result.nodes).toBeGreaterThanOrEqual(1);
    expect(result.sources).toContain('licences');
  });

  it('honours a declared cross-domain edge mapper (off-take → listing)', async () => {
    const stub = makeStubStore();
    globalThis.__kgIngestStore = stub.store;
    const db = makeStubDb({
      present: ['marketplace_listings', 'offtake_agreements'],
      rowsByTable: {
        marketplace_listings: [
          { id: 'list-1', title: 'Gold doré 5kg', category: 'mineral', status: 'active' },
        ],
        offtake_agreements: [
          { id: 'ot-1', status: 'signed', listing_id: 'list-1', buyer_id: 'buy-1' },
        ],
      },
    });

    await ingestKnowledgeGraph({ db, tenantId: TENANT });

    expect(stub.nodes.map((n) => n.id)).toContain('marketplace_listing:list-1');
    expect(stub.nodes.map((n) => n.id)).toContain('offtake_agreement:ot-1');
    // The declared `for-listing` edge connects the agreement to its listing.
    const edge = stub.edges.find((e) => e.label === 'for-listing');
    expect(edge).toBeDefined();
    expect(edge?.fromId).toBe('offtake_agreement:ot-1');
    expect(edge?.toId).toBe('marketplace_listing:list-1');
  });
});
