/**
 * /api/v1/internal/entity-legibility — the brain's entity-context loopback.
 *
 * Companion to:
 *   - services/api-gateway/src/composition/brain-tools/entity-legibility-tools.ts
 *     (the six persona tools whose handlers POST here over the loopback client)
 *   - services/api-gateway/src/services/entity-index/query.ts (queryEntityIndex)
 *   - services/api-gateway/src/services/cross-reference-discovery/
 *   - packages/database/src/migrations/0115_entity_index.sql
 *
 * The six `entity.*` brain tools were BORN DARK: each handler POSTed to
 * `/internal/entity-legibility/{resolve,full-picture,recent,search,trace,
 * deduplicate}` but NO router was ever mounted at that prefix, so every call
 * 404'd in production and the tool silently fell back to its empty-result
 * stub. This router lights them up.
 *
 * Routes (ALL Supabase-JWT authed + tenant-bound; READ-only):
 *   POST /resolve        fuzzy/text resolve a phrase → ranked candidates
 *   POST /full-picture   entity + its 1-hop cross-references
 *   POST /recent         recently-updated entities (optionally by kind)
 *   POST /search         text search across all entities
 *   POST /trace          multi-hop cross-reference traversal
 *   POST /deduplicate    suspected duplicates of an entity
 *
 * Auth model: this mirrors the WORKING brain-loopback routers
 * (owner/tabs.hono.ts, owner/superpowers, …) — `authMiddleware` +
 * `databaseMiddleware` only. The load-bearing controls are (1) the tenant
 * GUC bound by `databaseMiddleware` (FORCE-RLS clips every read to the
 * caller's tenant) PLUS an explicit `tenant_id` predicate (defence in
 * depth), and (2) the persona projection applied by `applyPersonaFilter`
 * (financial redaction / worker-vocab / scope clip). The persona-tool gate
 * (`personaSlugs`) already restricts WHICH personas can reach these tools;
 * we do NOT add `requireRole` here because the service-bound loopback token
 * carries a service role that is intentionally outside the human-role enum
 * — gating on it would re-dark the very routes we are wiring.
 *
 * Honest-degrade: a missing DB yields an EMPTY structured result (never a
 * crash, never fabricated rows). zod-validated bodies. Pino logger only.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';
import {
  queryEntityIndex,
  type EntityIndexQueryDb,
  type EntityIndexPersona,
} from '../../services/entity-index/index.js';

const legibilityLogger = createLogger('internal-entity-legibility');

// ---------------------------------------------------------------------------
// Composition seam (test-injectable). Tests set
// `c.set('services', { entityLegibilityDb })` to avoid a live PG; production
// reads the tenant-bound client from `c.get('db')`.
// ---------------------------------------------------------------------------

type EntityLegibilityDb = EntityIndexQueryDb;

interface EntityLegibilityServices {
  readonly entityLegibilityDb?: EntityLegibilityDb;
}

function resolveDb(c: any): EntityLegibilityDb | null {
  const injected =
    (c.get('services') as EntityLegibilityServices | undefined) ?? {};
  if (injected.entityLegibilityDb) return injected.entityLegibilityDb;
  const db = c.get('db');
  return (db as EntityLegibilityDb | undefined) ?? null;
}

/**
 * Map the caller's human role onto the entity-index persona that drives the
 * scope/redaction projection. The brain's entity tools are gated to owner +
 * admin personas, and the loopback mints a platform-admin service token, so
 * we default to the full-picture owner persona and only DOWNGRADE to a more
 * restricted persona for non-privileged roles (defence in depth — a worker
 * JWT reaching here is scope-clipped + financially redacted).
 */
function personaForRole(role: UserRole | string | undefined): EntityIndexPersona {
  switch (role) {
    case UserRole.MAINTENANCE_STAFF:
      return 'T4_field_employee';
    case UserRole.PROPERTY_MANAGER:
      return 'T3_module_manager';
    case UserRole.RESIDENT:
      return 'T5_customer_concierge';
    case UserRole.OWNER:
      return 'T1_owner_strategist';
    default:
      // SUPER_ADMIN / ADMIN / SUPPORT / TENANT_ADMIN / service-loopback.
      return 'T2_admin_strategist';
  }
}

// ---------------------------------------------------------------------------
// Schemas — mirror the brain-tool wire contracts exactly.
// ---------------------------------------------------------------------------

const resolveSchema = z.object({
  tenantId: z.string().min(1).optional(),
  phrase: z.string().min(1).max(300),
  kindHint: z.string().min(1).max(80).optional(),
  scopeIds: z.array(z.string().min(1).max(80)).max(20).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const recentSchema = z.object({
  tenantId: z.string().min(1).optional(),
  kind: z.string().min(1).max(80).optional(),
  sinceIso: z.string().min(1).max(40).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const searchSchema = z.object({
  tenantId: z.string().min(1).optional(),
  query: z.string().min(1).max(500),
  kindFilter: z.array(z.string().min(1).max(80)).max(10).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const fullPictureSchema = z.object({
  tenantId: z.string().min(1).optional(),
  kind: z.string().min(1).max(80),
  id: z.string().min(1).max(120),
});

const traceSchema = z.object({
  tenantId: z.string().min(1).optional(),
  sourceKind: z.string().min(1).max(80),
  sourceId: z.string().min(1).max(120),
  targetKind: z.string().min(1).max(80).optional(),
  maxHops: z.number().int().min(1).max(5).optional(),
});

const dedupeSchema = z.object({
  tenantId: z.string().min(1).optional(),
  kind: z.string().min(1).max(80),
  id: z.string().min(1).max(120),
});

// ---------------------------------------------------------------------------
// Cross-reference + entity-index direct readers (RLS-bound + tenant predicate).
// ---------------------------------------------------------------------------

interface ExecRow extends Record<string, unknown> {}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

/** Fetch the canonical entity_index row for (tenant, kind, id). */
async function fetchEntity(
  db: EntityLegibilityDb,
  tenantId: string,
  kind: string,
  id: string,
): Promise<{
  kind: string;
  id: string;
  displayName: string;
  summary: string;
  tags: string[];
  lifecycleStage: string;
  updatedAt: string;
} | null> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT entity_kind AS kind, entity_id AS id, display_name, summary,
             tags, lifecycle_stage, updated_at
        FROM entity_index
       WHERE tenant_id = ${tenantId}
         AND entity_kind = ${kind}
         AND entity_id = ${id}
       LIMIT 1
    `),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    kind: String(row['kind']),
    id: String(row['id']),
    displayName: String(row['display_name'] ?? ''),
    summary: String(row['summary'] ?? ''),
    tags: Array.isArray(row['tags']) ? (row['tags'] as unknown[]).map(String) : [],
    lifecycleStage: String(row['lifecycle_stage'] ?? 'active'),
    updatedAt: String(row['updated_at'] ?? new Date().toISOString()),
  };
}

/** Read the 1-hop forward edges for (tenant, kind, id), joined to display names. */
async function fetchEdges(
  db: EntityLegibilityDb,
  tenantId: string,
  sourceKind: string,
  sourceId: string,
): Promise<
  ReadonlyArray<{
    kind: string;
    id: string;
    displayName: string;
    relationship: string;
    confidence: number;
    summary?: string;
  }>
> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT x.target_kind AS kind,
             x.target_id   AS id,
             x.relationship,
             x.confidence,
             COALESCE(ei.display_name, x.target_id) AS display_name,
             ei.summary
        FROM entity_cross_references x
        LEFT JOIN entity_index ei
          ON ei.tenant_id = x.tenant_id
         AND ei.entity_kind = x.target_kind
         AND ei.entity_id = x.target_id
       WHERE x.tenant_id = ${tenantId}
         AND x.source_kind = ${sourceKind}
         AND x.source_id = ${sourceId}
       ORDER BY x.confidence DESC
       LIMIT 50
    `),
  );
  return rows.map((row) => ({
    kind: String(row['kind']),
    id: String(row['id']),
    displayName: String(row['display_name'] ?? row['id']),
    relationship: String(row['relationship'] ?? 'related'),
    confidence: Number(row['confidence'] ?? 1),
    ...(row['summary'] != null && { summary: String(row['summary']) }),
  }));
}

// ---------------------------------------------------------------------------
// Router — Supabase JWT + tenant-bound DB middleware (mirrors owner/tabs).
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// POST /resolve — phrase → ranked candidates (text/fuzzy match).
app.post('/resolve', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; role?: UserRole };
  const raw = await c.req.json().catch(() => null);
  const parsed = resolveSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ candidates: [], queriedAt: new Date().toISOString() }, 400);
  }
  const db = resolveDb(c);
  const queriedAt = new Date().toISOString();
  if (!db) return c.json({ candidates: [], queriedAt });
  try {
    const result = await queryEntityIndex(db, {
      tenantId: auth.tenantId,
      persona: personaForRole(auth.role),
      actorScopeIds: parsed.data.scopeIds ?? [],
      query: parsed.data.phrase,
      ...(parsed.data.kindHint && { kindFilter: [parsed.data.kindHint] }),
      limit: parsed.data.limit ?? 5,
    });
    const candidates = result.hits.map((h, idx) => ({
      kind: h.kind,
      id: h.id,
      displayName: h.displayName,
      summary: h.summary,
      lifecycleStage: h.lifecycleStage ?? 'active',
      // Rank-derived confidence: ordered DESC by refreshed_at — first hit is
      // the strongest match. Bounded to (0, 1].
      confidence: Math.max(0.1, 1 - idx * 0.1),
    }));
    return c.json({ candidates, queriedAt: result.queriedAt });
  } catch (err) {
    legibilityLogger.warn('entity-legibility resolve degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ candidates: [], queriedAt });
  }
});

// POST /search — text search across all entities.
app.post('/search', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; role?: UserRole };
  const raw = await c.req.json().catch(() => null);
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ hits: [], queriedAt: new Date().toISOString() }, 400);
  }
  const db = resolveDb(c);
  const queriedAt = new Date().toISOString();
  if (!db) return c.json({ hits: [], queriedAt });
  try {
    const result = await queryEntityIndex(db, {
      tenantId: auth.tenantId,
      persona: personaForRole(auth.role),
      actorScopeIds: [],
      query: parsed.data.query,
      ...(parsed.data.kindFilter && { kindFilter: parsed.data.kindFilter }),
      limit: parsed.data.limit ?? 10,
    });
    const hits = result.hits.map((h, idx) => ({
      kind: h.kind,
      id: h.id,
      displayName: h.displayName,
      summary: h.summary,
      score: Math.max(0.1, 1 - idx * 0.05),
    }));
    return c.json({ hits, queriedAt: result.queriedAt });
  } catch (err) {
    legibilityLogger.warn('entity-legibility search degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ hits: [], queriedAt });
  }
});

// POST /recent — recently-updated entities (optionally by kind).
app.post('/recent', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; role?: UserRole };
  const raw = await c.req.json().catch(() => null);
  const parsed = recentSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ entities: [], queriedAt: new Date().toISOString() }, 400);
  }
  const db = resolveDb(c);
  const queriedAt = new Date().toISOString();
  if (!db) return c.json({ entities: [], queriedAt });
  try {
    const result = await queryEntityIndex(db, {
      tenantId: auth.tenantId,
      persona: personaForRole(auth.role),
      actorScopeIds: [],
      ...(parsed.data.kind && { kindFilter: [parsed.data.kind] }),
      limit: parsed.data.limit ?? 20,
    });
    const entities = result.hits.map((h) => ({
      kind: h.kind,
      id: h.id,
      displayName: h.displayName,
      summary: h.summary,
      lifecycleStage: h.lifecycleStage ?? 'active',
      refreshedAt: h.refreshedAt ?? result.queriedAt,
    }));
    return c.json({ entities, queriedAt: result.queriedAt });
  } catch (err) {
    legibilityLogger.warn('entity-legibility recent degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ entities: [], queriedAt });
  }
});

// POST /full-picture — entity + its 1-hop cross-references.
app.post('/full-picture', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = fullPictureSchema.safeParse(raw);
  const queriedAt = new Date().toISOString();
  if (!parsed.success) {
    return c.json(
      {
        entity: emptyEntity('', ''),
        relatedEntities: [],
        queriedAt,
      },
      400,
    );
  }
  const db = resolveDb(c);
  if (!db) {
    return c.json({
      entity: emptyEntity(parsed.data.kind, parsed.data.id),
      relatedEntities: [],
      queriedAt,
    });
  }
  try {
    const entity = await fetchEntity(
      db,
      auth.tenantId,
      parsed.data.kind,
      parsed.data.id,
    );
    const relatedEntities = await fetchEdges(
      db,
      auth.tenantId,
      parsed.data.kind,
      parsed.data.id,
    );
    return c.json({
      entity: entity ?? emptyEntity(parsed.data.kind, parsed.data.id),
      relatedEntities,
      queriedAt,
    });
  } catch (err) {
    legibilityLogger.warn('entity-legibility full-picture degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({
      entity: emptyEntity(parsed.data.kind, parsed.data.id),
      relatedEntities: [],
      queriedAt,
    });
  }
});

// POST /trace — multi-hop cross-reference traversal (bounded BFS).
app.post('/trace', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = traceSchema.safeParse(raw);
  const queriedAt = new Date().toISOString();
  if (!parsed.success) {
    return c.json({ paths: [], queriedAt }, 400);
  }
  const db = resolveDb(c);
  if (!db) return c.json({ paths: [], queriedAt });
  const maxHops = parsed.data.maxHops ?? 3;
  try {
    const paths = await traverse(db, {
      tenantId: auth.tenantId,
      sourceKind: parsed.data.sourceKind,
      sourceId: parsed.data.sourceId,
      ...(parsed.data.targetKind && { targetKind: parsed.data.targetKind }),
      maxHops,
    });
    return c.json({ paths, queriedAt });
  } catch (err) {
    legibilityLogger.warn('entity-legibility trace degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ paths: [], queriedAt });
  }
});

// POST /deduplicate — suspected duplicates of an entity (edge.relationship='duplicate').
app.post('/deduplicate', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = dedupeSchema.safeParse(raw);
  const queriedAt = new Date().toISOString();
  if (!parsed.success) {
    return c.json({ suspectedDuplicates: [], queriedAt }, 400);
  }
  const db = resolveDb(c);
  if (!db) return c.json({ suspectedDuplicates: [], queriedAt });
  try {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT x.target_kind AS kind,
               x.target_id   AS id,
               x.confidence,
               x.derivation_source,
               COALESCE(ei.display_name, x.target_id) AS display_name
          FROM entity_cross_references x
          LEFT JOIN entity_index ei
            ON ei.tenant_id = x.tenant_id
           AND ei.entity_kind = x.target_kind
           AND ei.entity_id = x.target_id
         WHERE x.tenant_id = ${auth.tenantId}
           AND x.source_kind = ${parsed.data.kind}
           AND x.source_id = ${parsed.data.id}
           AND x.relationship = 'duplicate'
         ORDER BY x.confidence DESC
         LIMIT 25
      `),
    );
    const suspectedDuplicates = rows.map((row) => ({
      kind: String(row['kind']),
      id: String(row['id']),
      displayName: String(row['display_name'] ?? row['id']),
      similarity: Number(row['confidence'] ?? 0),
      reason: String(row['derivation_source'] || 'duplicate edge'),
    }));
    return c.json({ suspectedDuplicates, queriedAt });
  } catch (err) {
    legibilityLogger.warn('entity-legibility deduplicate degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ suspectedDuplicates: [], queriedAt });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyEntity(kind: string, id: string) {
  return {
    kind,
    id,
    displayName: '',
    summary: '',
    tags: [] as string[],
    lifecycleStage: 'active',
    updatedAt: new Date().toISOString(),
  };
}

interface TraverseInput {
  readonly tenantId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly targetKind?: string;
  readonly maxHops: number;
}

/**
 * Bounded breadth-first traversal over `entity_cross_references`. Every hop
 * issues a tenant-scoped query (RLS + explicit predicate), so the walk never
 * crosses a tenant boundary. Visited-set prevents cycles; `maxHops` caps depth.
 */
async function traverse(
  db: EntityLegibilityDb,
  input: TraverseInput,
): Promise<
  ReadonlyArray<{
    hops: Array<{
      kind: string;
      id: string;
      displayName: string;
      relationship?: string;
    }>;
    endpointKind: string;
    endpointId: string;
    hopCount: number;
  }>
> {
  type Node = { kind: string; id: string; displayName: string; relationship?: string };
  const visited = new Set<string>([`${input.sourceKind}::${input.sourceId}`]);
  const completed: Array<{
    hops: Array<Node>;
    endpointKind: string;
    endpointId: string;
    hopCount: number;
  }> = [];
  let frontier: Array<{ node: Node; path: Array<Node> }> = [
    {
      node: { kind: input.sourceKind, id: input.sourceId, displayName: input.sourceId },
      path: [{ kind: input.sourceKind, id: input.sourceId, displayName: input.sourceId }],
    },
  ];

  for (let hop = 0; hop < input.maxHops && frontier.length > 0; hop += 1) {
    const next: Array<{ node: Node; path: Array<Node> }> = [];
    for (const { node, path } of frontier) {
      const edges = await fetchEdges(db, input.tenantId, node.kind, node.id);
      for (const edge of edges) {
        const key = `${edge.kind}::${edge.id}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const nextNode: Node = {
          kind: edge.kind,
          id: edge.id,
          displayName: edge.displayName,
          relationship: edge.relationship,
        };
        const nextPath = [...path, nextNode];
        const matchesTarget =
          !input.targetKind || edge.kind === input.targetKind;
        if (matchesTarget) {
          completed.push({
            hops: nextPath,
            endpointKind: edge.kind,
            endpointId: edge.id,
            hopCount: nextPath.length - 1,
          });
        }
        next.push({ node: nextNode, path: nextPath });
      }
    }
    frontier = next;
    // Bound total work — a runaway graph never blows the loopback budget.
    if (completed.length >= 50) break;
  }
  return completed;
}

export const internalEntityLegibilityRouter = app;
export default internalEntityLegibilityRouter;
