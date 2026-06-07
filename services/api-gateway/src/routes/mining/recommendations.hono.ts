/**
 * /api/v1/mining/recommendations — Mr. Mwikila's matching engine.
 *
 * Wires the REAL `@borjie/recommendations` compute (content-based +
 * matrix-factorization ensemble, item-item CF, MMR diversity rerank, PO-14
 * audit-chain seal) onto the tenant's LIVE marketplace data. Nothing is
 * fabricated: candidate items are read from `marketplace_listings` and the
 * interaction signal is read from `ratings` (real reputation rows). When the
 * tenant has no candidates the route returns a real degraded payload (empty
 * ranking + a note), never invented matches.
 *
 * Three match flows are exposed (the buyer/worker/supplier subset of the
 * package's five domain wrappers — the regulator/course flows have no live
 * candidate table yet and are intentionally omitted rather than faked):
 *
 *   buyer_mine     buyer ↔ producing pit   (ensemble:content_based,matrix_factorization)
 *   worker_site    worker ↔ site / shift   (item_item_cf)
 *   supplier_mine  supplier ↔ pit          (matrix_factorization)
 *
 * Routes:
 *   GET  /runs              list this tenant's recent persisted runs (replay)
 *   GET  /match             compute a ranking for a target + persist it
 *   POST /match             same, but the caller supplies candidates/topK
 *
 * PERSISTENCE: every computed ranking is written to `recommendation_runs`
 * via the package's `createSqlRecommendationRepository`, which hash-chains
 * each run (PO-14, tamper-evident). The SQL adapter's `$n`-parameterised
 * statements are bound through the request's reserved, tenant-pinned Drizzle
 * connection (see databaseMiddleware) so RLS fires — migration 0296 repoints
 * the `recommendation_runs` / `recommendation_feedback` policies onto the
 * canonical `app.current_tenant_id` GUC + FORCE RLS.
 *
 * EVIDENCE (CLAUDE.md "evidence-required AI output"): every match carries an
 * `evidenceIds` list of the concrete `listing:<id>` / `rating:<id>` row ids
 * that fed the ranking, plus the persisted `runId` for replay, so the owner
 * can trace each recommendation back to ground truth.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; every query also
 * passes `tenantId` into the where-clause / repository (defence in depth).
 */

import { Hono } from 'hono';
import { and, desc, eq, sql, type SQLChunk } from 'drizzle-orm';
import { z } from 'zod';
import { marketplaceListings, ratings } from '@borjie/database';
import {
  buyerMineMatch,
  workerSiteMatch,
  supplierMineMatch,
  createSqlRecommendationRepository,
  type Item,
  type Interaction,
  type MatchTarget,
  type RecommendationRequest,
  type RecommendationResult,
  type SqlExecutor,
} from '@borjie/recommendations';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-recommendations');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/** The live-candidate match targets this route serves. */
const SUPPORTED_TARGETS = ['buyer_mine', 'worker_site', 'supplier_mine'] as const;
type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

const matchQuerySchema = z.object({
  target: z.enum(SUPPORTED_TARGETS).default('buyer_mine'),
  /** The actor the ranking is FOR (buyer / worker / supplier id). */
  userId: z.string().min(1),
  topK: z.coerce.number().int().positive().max(50).default(10),
  /** Optional marketplace category filter for the candidate pool. */
  category: z.string().min(1).max(80).optional(),
});
type MatchQuery = z.infer<typeof matchQuerySchema>;

const matchBodySchema = matchQuerySchema.extend({
  /**
   * Optional explicit candidate item ids. When supplied the route ranks
   * exactly these (still tenant-scoped); otherwise it sources candidates
   * from the marketplace.
   */
  candidateIds: z.array(z.string().min(1)).max(500).optional(),
});

const runsQuerySchema = z.object({
  target: z.enum(SUPPORTED_TARGETS).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

// ---------------------------------------------------------------------------
// Live-row → package-contract translation (pure)
// ---------------------------------------------------------------------------

type ListingRow = typeof marketplaceListings.$inferSelect;
type RatingRow = typeof ratings.$inferSelect;

/** Read one numeric attribute from a listing's `attributes` JSON blob. */
function readNumericAttr(attributes: unknown, key: string): number | null {
  if (!attributes || typeof attributes !== 'object') return null;
  const raw = (attributes as Record<string, unknown>)[key];
  const num = typeof raw === 'string' ? Number(raw) : raw;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
}

/**
 * Build the candidate Item set from marketplace listings. Each item carries
 * a small REAL feature vector derived from the listing (price + grade +
 * tonnage when present) so the content-based recommender has signal. A
 * listing with no usable numeric feature still contributes (zero-filled),
 * never dropped — the ranking degrades gracefully rather than inventing.
 */
function toItems(
  rows: ReadonlyArray<ListingRow>,
  tenantId: string,
): ReadonlyArray<Item> {
  return rows.map((r) => {
    const price = r.priceTzs === null ? 0 : Number(r.priceTzs);
    const grade = readNumericAttr(r.attributes, 'grade') ?? 0;
    const tonnage = readNumericAttr(r.attributes, 'tonnage') ?? 0;
    return {
      tenantId,
      id: r.id,
      features: {
        price: Number.isFinite(price) ? price : 0,
        grade,
        tonnage,
        category: r.category,
      },
      embedding: {
        tenantId,
        id: r.id,
        // Deterministic real-valued embedding from the listing's own
        // measured features — no random init, no fabricated vector.
        values: [
          Number.isFinite(price) ? price : 0,
          grade,
          tonnage,
        ],
      },
    };
  });
}

/**
 * Build the interaction set from `ratings` rows. A rating of a listing
 * (subject_kind='listing') by the requesting actor — or by any actor in the
 * tenant — is a real engagement signal the CF / matrix-factorization
 * recommenders consume. score (1-5) maps straight onto the rating value.
 */
function toInteractions(
  rows: ReadonlyArray<RatingRow>,
  tenantId: string,
): ReadonlyArray<Interaction> {
  const out: Interaction[] = [];
  for (const r of rows) {
    if (!r.raterUserId) continue;
    const rating = Number(r.score);
    if (!Number.isFinite(rating)) continue;
    out.push({
      tenantId,
      userId: r.raterUserId,
      itemId: r.subjectId,
      rating,
      timestamp: r.ts instanceof Date ? r.ts.getTime() : Date.now(),
    });
  }
  return out;
}

/** Dispatch to the REAL domain wrapper for the requested target. */
function computeRanking(
  target: SupportedTarget,
  request: RecommendationRequest,
): RecommendationResult {
  switch (target) {
    case 'buyer_mine':
      return buyerMineMatch(request);
    case 'worker_site':
      return workerSiteMatch(request);
    case 'supplier_mine':
      return supplierMineMatch(request);
    default: {
      // Exhaustiveness guard — unreachable given the zod enum.
      const never: never = target;
      throw new Error(`unsupported target: ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// SqlExecutor adapter — bind the package's `$n` statements through the
// request's tenant-pinned Drizzle connection so RLS fires.
// ---------------------------------------------------------------------------

interface DrizzleExecLike {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

/**
 * Translate a `$1..$n`-parameterised SQL string + params array into a single
 * Drizzle `sql` fragment (interleaving raw static chunks with bound params
 * via `sql.join`), then run it on the request connection. This preserves
 * parameter binding (no string interpolation) while reusing the package's
 * repository SQL verbatim. Same idiom as routes/owner/handoff.hono.ts.
 */
function createExecutor(db: DrizzleExecLike): SqlExecutor {
  return {
    async query<T = unknown>(
      text: string,
      params: ReadonlyArray<unknown>,
    ): Promise<ReadonlyArray<T>> {
      const parts = text.split(/\$\d+/);
      const fragments: SQLChunk[] = [];
      for (let i = 0; i < parts.length; i += 1) {
        fragments.push(sql.raw(parts[i] ?? ''));
        if (i < params.length) fragments.push(params[i] as SQLChunk);
      }
      const composed = sql.join(fragments, sql.raw(''));
      const raw = await db.execute(composed);
      return rowsOf(raw) as ReadonlyArray<T>;
    },
  };
}

// ---------------------------------------------------------------------------
// Core compute + persist
// ---------------------------------------------------------------------------

interface MatchComputation {
  readonly result: RecommendationResult;
  readonly runId: string;
  readonly evidenceIds: ReadonlyArray<string>;
}

async function computeAndPersist(
  db: DrizzleExecLike & {
    select: () => {
      from: (t: unknown) => {
        where: (c: unknown) => {
          orderBy: (...o: unknown[]) => { limit: (n: number) => Promise<unknown[]> };
        };
      };
    };
  },
  args: {
    readonly tenantId: string;
    readonly query: MatchQuery;
    readonly candidateIds?: ReadonlyArray<string>;
  },
): Promise<MatchComputation | { readonly degraded: true; readonly note: string }> {
  const { tenantId, query } = args;

  // ── 1) Source candidate listings (tenant + active + optional category) ──
  const conds = [
    eq(marketplaceListings.tenantId, tenantId),
    eq(marketplaceListings.status, 'active'),
  ];
  if (query.category) {
    conds.push(eq(marketplaceListings.category, query.category));
  }
  const listingRows = (await db
    .select()
    .from(marketplaceListings)
    .where(and(...conds))
    .orderBy(desc(marketplaceListings.createdAt))
    .limit(500)) as ListingRow[];

  const filteredListings = args.candidateIds
    ? listingRows.filter((r) => args.candidateIds?.includes(r.id))
    : listingRows;

  if (filteredListings.length === 0) {
    return { degraded: true, note: 'no active marketplace candidates for tenant' };
  }

  // ── 2) Source real interaction signal from ratings ──────────────────────
  const ratingRows = (await db
    .select()
    .from(ratings)
    .where(eq(ratings.tenantId, tenantId))
    .orderBy(desc(ratings.ts))
    .limit(2000)) as RatingRow[];

  const candidates = toItems(filteredListings, tenantId);
  const interactions = toInteractions(ratingRows, tenantId);

  // ── 3) Compute the REAL ranking ─────────────────────────────────────────
  const request: RecommendationRequest = {
    tenantId,
    target: query.target as MatchTarget,
    userId: query.userId,
    candidates,
    interactions,
    topK: query.topK,
  };
  const result = computeRanking(query.target, request);

  // ── 4) Persist the run (hash-chained) through the package repository ─────
  const repo = createSqlRecommendationRepository({ executor: createExecutor(db) });
  const run = await repo.saveRun({
    tenantId,
    target: query.target as MatchTarget,
    result,
  });

  moduleLogger.debug('recommendation run persisted', {
    tenantId,
    target: query.target,
    runId: run.id,
    candidates: candidates.length,
    topK: result.topK.length,
  });

  // ── 5) Evidence chain — the concrete rows that fed the ranking ──────────
  const rankedIds = new Set(result.topK.map((s) => s.itemId));
  const evidenceIds = Array.from(
    new Set([
      ...filteredListings.filter((l) => rankedIds.has(l.id)).map((l) => `listing:${l.id}`),
      ...ratingRows
        .filter((r) => rankedIds.has(r.subjectId))
        .map((r) => `rating:${r.id}`),
    ]),
  );

  return { result, runId: run.id, evidenceIds };
}

function degradedPayload(note: string) {
  return {
    success: true as const,
    data: {
      target: null,
      runId: null,
      topK: [] as ReadonlyArray<unknown>,
      algorithm: null,
      evidenceIds: [] as ReadonlyArray<string>,
      note,
    },
  };
}

function okPayload(comp: MatchComputation) {
  return {
    success: true as const,
    data: {
      target: comp.result.target,
      runId: comp.runId,
      algorithm: comp.result.algorithm,
      topK: comp.result.topK,
      candidates: comp.result.candidates,
      auditHash: comp.result.auditHash,
      servedAt: comp.result.servedAt,
      evidenceIds: comp.evidenceIds,
    },
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

app.get('/match', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const parsed = matchQuerySchema.safeParse({
    target: c.req.query('target') ?? undefined,
    userId: c.req.query('userId'),
    topK: c.req.query('topK') ?? undefined,
    category: c.req.query('category') ?? undefined,
  });
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } },
      400,
    );
  }
  if (!db) {
    return c.json(degradedPayload('database not configured'), 200);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await computeAndPersist(db as any, { tenantId, query: parsed.data });
  if ('degraded' in result) {
    return c.json(degradedPayload(result.note), 200);
  }
  return c.json(okPayload(result), 200);
});

app.post('/match', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const raw = await c.req.json().catch(() => ({}));
  const parsed = matchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } },
      400,
    );
  }
  if (!db) {
    return c.json(degradedPayload('database not configured'), 200);
  }
  const { candidateIds, ...query } = parsed.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await computeAndPersist(db as any, {
    tenantId,
    query,
    ...(candidateIds ? { candidateIds } : {}),
  });
  if ('degraded' in result) {
    return c.json(degradedPayload(result.note), 200);
  }
  return c.json(okPayload(result), 200);
});

app.get('/runs', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const parsed = runsQuerySchema.safeParse({
    target: c.req.query('target') ?? undefined,
    limit: c.req.query('limit') ?? undefined,
  });
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } },
      400,
    );
  }
  if (!db) {
    return c.json({ success: true as const, data: [] }, 200);
  }
  const repo = createSqlRecommendationRepository({
    executor: createExecutor(db as DrizzleExecLike),
  });
  const runs = await repo.findRuns({
    tenantId,
    ...(parsed.data.target ? { target: parsed.data.target as MatchTarget } : {}),
    limit: parsed.data.limit,
  });
  return c.json({ success: true as const, data: runs }, 200);
});

export const miningRecommendationsRouter = app;
export default app;
