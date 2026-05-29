/**
 * Entity Legibility Brain Tools — Wave ENTITY-LEGIBILITY.
 *
 * Six tools that make the entire org legible to the brain. Mr. Mwikila
 * can refer to any entity by natural language ("the Geita PML",
 * "April's royalty", "the contract with Tabora Catering") and the
 * brain grounds the reference, returns a 1-hop graph, traces back
 * across the typed cross-reference edges, or surfaces duplicates.
 *
 *   1. entity.resolve       fuzzy + semantic lookup → ranked candidates
 *   2. entity.full_picture  entity + 1-hop cross-references
 *   3. entity.recent        per-kind recent activity feed
 *   4. entity.search        semantic search across all entities
 *   5. entity.trace         multi-hop graph traversal
 *   6. entity.deduplicate   surface suspected duplicates
 *
 * All tools are LOW stakes + READ-only by descriptor declaration, but
 * each call is hash-chained into the AI audit chain because the tool
 * surface is the brain's primary entity-context window. A regression
 * in `entity.resolve` would silently misroute every chat reply, so we
 * keep the full call/result record audit-logged.
 *
 * Tenant isolation: every call resolves `ctx.tenantId` and the
 * api-gateway middleware has already bound `app.tenant_id` GUC, so
 * every DB read is RLS-filtered.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

// ─── 1) entity.resolve ───────────────────────────────────────────────

const ResolveInput = z
  .object({
    phrase: z.string().min(1).max(300),
    kindHint: z.string().min(1).max(80).optional(),
    scopeIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    limit: z.number().int().min(1).max(20).optional().default(5),
  })
  .strict();

const ResolveOutput = z
  .object({
    candidates: z.array(
      z.object({
        kind: z.string(),
        id: z.string(),
        displayName: z.string(),
        summary: z.string(),
        lifecycleStage: z.string(),
        confidence: z.number(),
      }),
    ),
    queriedAt: z.string(),
  })
  .strict();

export const entityResolveTool: PersonaToolDescriptor<
  typeof ResolveInput,
  typeof ResolveOutput
> = {
  id: 'entity.resolve',
  name: 'Resolve a natural-language phrase to a concrete entity',
  description:
    'Look up the owner\'s entity index by fuzzy + semantic match. Returns ' +
    'ranked candidates with kind, id, displayName, summary, lifecycle ' +
    'stage, and confidence in [0,1]. NEVER invent ids — always call ' +
    'this first when the owner refers to an entity by phrase ("the ' +
    'Geita PML", "April\'s royalty", "the contract with Tabora ' +
    'Catering"). Pass `kindHint` when you already know the kind.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ResolveInput,
  outputSchema: ResolveOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { candidates: [], queriedAt: new Date().toISOString() };
    }
    return client.post<{
      candidates: ReadonlyArray<{
        kind: string;
        id: string;
        displayName: string;
        summary: string;
        lifecycleStage: string;
        confidence: number;
      }>;
      queriedAt: string;
    }>('/internal/entity-legibility/resolve', {
      tenantId: ctx.tenantId,
      phrase: input.phrase,
      ...(input.kindHint && { kindHint: input.kindHint }),
      ...(input.scopeIds && { scopeIds: input.scopeIds }),
      limit: input.limit ?? 5,
    });
  },
};

// ─── 2) entity.full_picture ──────────────────────────────────────────

const FullPictureInput = z
  .object({
    kind: z.string().min(1).max(80),
    id: z.string().min(1).max(120),
  })
  .strict();

const FullPictureOutput = z
  .object({
    entity: z.object({
      kind: z.string(),
      id: z.string(),
      displayName: z.string(),
      summary: z.string(),
      tags: z.array(z.string()),
      lifecycleStage: z.string(),
      updatedAt: z.string(),
    }),
    relatedEntities: z.array(
      z.object({
        kind: z.string(),
        id: z.string(),
        displayName: z.string(),
        relationship: z.string(),
        confidence: z.number(),
        summary: z.string().optional(),
      }),
    ),
    queriedAt: z.string(),
  })
  .strict();

export const entityFullPictureTool: PersonaToolDescriptor<
  typeof FullPictureInput,
  typeof FullPictureOutput
> = {
  id: 'entity.full_picture',
  name: 'Fetch an entity with its 1-hop cross-references',
  description:
    'Return the canonical entity + every entity it is connected to in ' +
    'one hop (parent / child / related / duplicate / depends_on / ' +
    'supersedes). Use after `entity.resolve` to compose a grounded ' +
    'reply that references related entities ("Your April royalty draft ' +
    '→ Geita PML → Mining Commission Q1 filing — all on track").',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: FullPictureInput,
  outputSchema: FullPictureOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        entity: {
          kind: input.kind,
          id: input.id,
          displayName: '',
          summary: '',
          tags: [],
          lifecycleStage: 'active',
          updatedAt: new Date().toISOString(),
        },
        relatedEntities: [],
        queriedAt: new Date().toISOString(),
      };
    }
    return client.post<{
      entity: {
        kind: string;
        id: string;
        displayName: string;
        summary: string;
        tags: string[];
        lifecycleStage: string;
        updatedAt: string;
      };
      relatedEntities: Array<{
        kind: string;
        id: string;
        displayName: string;
        relationship: string;
        confidence: number;
        summary?: string;
      }>;
      queriedAt: string;
    }>('/internal/entity-legibility/full-picture', {
      tenantId: ctx.tenantId,
      kind: input.kind,
      id: input.id,
    });
  },
};

// ─── 3) entity.recent ────────────────────────────────────────────────

const RecentInput = z
  .object({
    kind: z.string().min(1).max(80).optional(),
    sinceIso: z.string().min(1).max(40).optional(),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict();

const RecentOutput = z
  .object({
    entities: z.array(
      z.object({
        kind: z.string(),
        id: z.string(),
        displayName: z.string(),
        summary: z.string(),
        lifecycleStage: z.string(),
        refreshedAt: z.string(),
      }),
    ),
    queriedAt: z.string(),
  })
  .strict();

export const entityRecentTool: PersonaToolDescriptor<
  typeof RecentInput,
  typeof RecentOutput
> = {
  id: 'entity.recent',
  name: 'List recently updated entities (optionally by kind)',
  description:
    'Return the most recently updated entities for the owner. Pass ' +
    '`kind` to scope to one kind (e.g. "show me recent drill_holes"). ' +
    'Pass `sinceIso` to scope to a window ("what changed in the last ' +
    'hour"). Always sorted by refreshed_at DESC.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: RecentInput,
  outputSchema: RecentOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { entities: [], queriedAt: new Date().toISOString() };
    }
    return client.post<{
      entities: Array<{
        kind: string;
        id: string;
        displayName: string;
        summary: string;
        lifecycleStage: string;
        refreshedAt: string;
      }>;
      queriedAt: string;
    }>('/internal/entity-legibility/recent', {
      tenantId: ctx.tenantId,
      ...(input.kind && { kind: input.kind }),
      ...(input.sinceIso && { sinceIso: input.sinceIso }),
      limit: input.limit ?? 20,
    });
  },
};

// ─── 4) entity.search ────────────────────────────────────────────────

const SearchInput = z
  .object({
    query: z.string().min(1).max(500),
    kindFilter: z.array(z.string().min(1).max(80)).max(10).optional(),
    limit: z.number().int().min(1).max(20).optional().default(10),
  })
  .strict();

const SearchOutput = z
  .object({
    hits: z.array(
      z.object({
        kind: z.string(),
        id: z.string(),
        displayName: z.string(),
        summary: z.string(),
        score: z.number(),
      }),
    ),
    queriedAt: z.string(),
  })
  .strict();

export const entitySearchTool: PersonaToolDescriptor<
  typeof SearchInput,
  typeof SearchOutput
> = {
  id: 'entity.search',
  name: 'Semantic search across all entities',
  description:
    'Full semantic search over every entity in the owner\'s estate. ' +
    'Use when the question is open-ended ("anything related to ' +
    'Songwe?") and `entity.resolve` would be too narrow. Returns ' +
    'top-N hits ranked by cosine similarity (or fuzzy text match when ' +
    'no embedding is available).',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: SearchInput,
  outputSchema: SearchOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { hits: [], queriedAt: new Date().toISOString() };
    }
    return client.post<{
      hits: Array<{
        kind: string;
        id: string;
        displayName: string;
        summary: string;
        score: number;
      }>;
      queriedAt: string;
    }>('/internal/entity-legibility/search', {
      tenantId: ctx.tenantId,
      query: input.query,
      ...(input.kindFilter && { kindFilter: input.kindFilter }),
      limit: input.limit ?? 10,
    });
  },
};

// ─── 5) entity.trace ─────────────────────────────────────────────────

const TraceInput = z
  .object({
    sourceKind: z.string().min(1).max(80),
    sourceId: z.string().min(1).max(120),
    targetKind: z.string().min(1).max(80).optional(),
    maxHops: z.number().int().min(1).max(5).optional().default(3),
  })
  .strict();

const TraceOutput = z
  .object({
    paths: z.array(
      z.object({
        hops: z.array(
          z.object({
            kind: z.string(),
            id: z.string(),
            displayName: z.string(),
            relationship: z.string().optional(),
          }),
        ),
        endpointKind: z.string(),
        endpointId: z.string(),
        hopCount: z.number().int().nonnegative(),
      }),
    ),
    queriedAt: z.string(),
  })
  .strict();

export const entityTraceTool: PersonaToolDescriptor<
  typeof TraceInput,
  typeof TraceOutput
> = {
  id: 'entity.trace',
  name: 'Trace an entity back to a related entity across hops',
  description:
    'Walk the cross-reference graph from a source entity to either a ' +
    'target kind ("trace this incident back to a drill_hole") or up to ' +
    '`maxHops` away. Returns every path found, each as an ordered list ' +
    'of (kind, id, displayName, relationship). Use to answer "show me ' +
    'everything connected to X" or "where did this signal originate".',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: TraceInput,
  outputSchema: TraceOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { paths: [], queriedAt: new Date().toISOString() };
    }
    return client.post<{
      paths: Array<{
        hops: Array<{
          kind: string;
          id: string;
          displayName: string;
          relationship?: string;
        }>;
        endpointKind: string;
        endpointId: string;
        hopCount: number;
      }>;
      queriedAt: string;
    }>('/internal/entity-legibility/trace', {
      tenantId: ctx.tenantId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      ...(input.targetKind && { targetKind: input.targetKind }),
      maxHops: input.maxHops ?? 3,
    });
  },
};

// ─── 6) entity.deduplicate ───────────────────────────────────────────

const DedupeInput = z
  .object({
    kind: z.string().min(1).max(80),
    id: z.string().min(1).max(120),
  })
  .strict();

const DedupeOutput = z
  .object({
    suspectedDuplicates: z.array(
      z.object({
        kind: z.string(),
        id: z.string(),
        displayName: z.string(),
        similarity: z.number(),
        reason: z.string(),
      }),
    ),
    queriedAt: z.string(),
  })
  .strict();

export const entityDeduplicateTool: PersonaToolDescriptor<
  typeof DedupeInput,
  typeof DedupeOutput
> = {
  id: 'entity.deduplicate',
  name: 'Surface suspected duplicates of an entity',
  description:
    'Return entities of the same kind whose embedding or display_name ' +
    'is close enough to suggest a duplicate (same counterparty under ' +
    'two names, two licences with the same number, etc.). Never auto- ' +
    'merges — surfaces the suggestion so Mr. Mwikila can confirm with ' +
    'the owner.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: DedupeInput,
  outputSchema: DedupeOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { suspectedDuplicates: [], queriedAt: new Date().toISOString() };
    }
    return client.post<{
      suspectedDuplicates: Array<{
        kind: string;
        id: string;
        displayName: string;
        similarity: number;
        reason: string;
      }>;
      queriedAt: string;
    }>('/internal/entity-legibility/deduplicate', {
      tenantId: ctx.tenantId,
      kind: input.kind,
      id: input.id,
    });
  },
};

// ─── Catalog export ──────────────────────────────────────────────────

export const ENTITY_LEGIBILITY_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  entityResolveTool,
  entityFullPictureTool,
  entityRecentTool,
  entitySearchTool,
  entityTraceTool,
  entityDeduplicateTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
