/**
 * Jurisdiction promotion route — the governed "unlock a new market" surface.
 *
 * Turns "which countries users may select" from a code deploy into a governed
 * data action against the `enabled_countries` registry (migration 0337). Seeded
 * with TZ only; promoting a new market (e.g. US) is an admin/MD action AFTER
 * Mr. Mwikila has learned the jurisdiction (discover() + ingested compliance
 * corpus). Backs the MD brain-tool `mwikila.jurisdiction.promote`.
 *
 *   GET  /admin/jurisdictions                       → list enabled countries
 *   POST /admin/jurisdictions/:code/enable          → promote a country (platform-admin)
 *   POST /admin/jurisdictions/:code/disable         → soft-disable a country
 *   POST /admin/jurisdictions/:code/ingest-compliance → LEARN a country's compliance
 *
 * Auth: platform-admin only (SUPER_ADMIN | ADMIN). Promotion is HIGH-risk — the
 * MD path additionally flows through the autonomy gate + R7 shadow-certify
 * before reaching here.
 *
 * THE LEARN-FEED (ingest-compliance): an admin (or the MD via the
 * `mwikila.jurisdiction.ingest_compliance` brain-tool) submits a country's
 * regulatory TEXT. The handler chunks it and writes each chunk into the
 * SHARED corpus (`intelligence_corpus_chunks` with `tenant_id = NULL`, so
 * EVERY tenant inherits the ground truth) tagged by country, then records
 * provenance in `compliance_doc_uploads`. The next `discover(country)`
 * corpus probe (ILIKE over `text` + `source_file`) then finds it, and
 * `promote` can unlock the market. This is what makes "upload USA compliance
 * → switching to US becomes possible" REAL.
 */

import { createHash, randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  createEnabledJurisdictionsService,
  intelligenceCorpusChunks,
} from '@borjie/database';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { chunkComplianceText } from './compliance-corpus-chunker';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
]);

const EnableInput = z.object({
  name: z.string().min(1),
  currencyCode: z.string().min(3).max(3).optional(),
  learnedFromCorpus: z.boolean().optional(),
  evidence: z.string().optional(),
});

// The compliance learn-feed body. `content` is the regulatory TEXT (required);
// this is PUBLIC regulatory ground truth by definition — it is written into the
// SHARED (tenant_id = NULL) corpus, so it must NEVER carry tenant-private data
// or PII. The caller asserts this with `isRegulatory: true` (a deliberate gate,
// not a checkbox we ignore) — we refuse the write otherwise.
const IngestComplianceInput = z.object({
  /** Free-form classifier, e.g. 'mining_act', 'royalty_schedule', 'eia_regulation'. */
  docType: z.string().min(1).max(120).optional(),
  /** Human title of the source document (used in the chunk section tag). */
  title: z.string().min(1).max(300),
  /** The regulatory prose to learn. REQUIRED — never silently dropped. */
  content: z.string().min(1).max(500_000),
  /** Live citation URL (gov gazette / agency portal). */
  sourceUrl: z.string().url().max(2048).optional(),
  /** ISO-639-1 language of the content. Defaults to 'en'. */
  language: z.string().min(2).max(5).optional(),
  /**
   * Affirmative assertion that this is PUBLIC regulatory content (not
   * tenant-private data / PII). Gates the shared-corpus write. Defaults to
   * true for the MD/admin path; an explicit `false` is rejected.
   */
  isRegulatory: z.boolean().optional(),
});

const CODE_RX = /^[A-Za-z]{2,3}$/;

/** Provenance prefix tying every learn-feed chunk back to its country. */
const COMPLIANCE_SOURCE_PREFIX = 'admin:jurisdiction:';

export function createJurisdictionPromotionRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  function isPlatformAdmin(c: any): boolean {
    const role = (c.get('auth') ?? {}).role as UserRole | undefined;
    return role !== undefined && PLATFORM_ADMIN_ROLES.has(role);
  }

  // GET /admin/jurisdictions — the live launch market.
  app.get('/', async (c: any) => {
    if (!isPlatformAdmin(c)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'platform-admin only' } }, 403);
    }
    const svc = createEnabledJurisdictionsService(c.get('db'));
    const rows = await svc.listEnabledRows();
    return c.json({ success: true, data: { countries: rows } }, 200);
  });

  // POST /admin/jurisdictions/:code/enable — promote a learned country.
  app.post('/:code/enable', async (c: any) => {
    if (!isPlatformAdmin(c)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'platform-admin only' } }, 403);
    }
    const code = c.req.param('code');
    if (!CODE_RX.test(code ?? '')) {
      return c.json({ success: false, error: { code: 'BAD_CODE', message: 'ISO-3166-1 alpha-2 required' } }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: { code: 'BAD_JSON', message: 'body must be JSON' } }, 400);
    }
    const parsed = EnableInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? 'invalid' } }, 400);
    }
    const auth = c.get('auth') ?? {};
    const svc = createEnabledJurisdictionsService(c.get('db'));
    const row = await svc.enableCountry({
      code,
      name: parsed.data.name,
      ...(parsed.data.currencyCode ? { currencyCode: parsed.data.currencyCode } : {}),
      ...(auth.userId ? { enabledByAdminId: auth.userId as string } : {}),
      ...(parsed.data.learnedFromCorpus !== undefined ? { learnedFromCorpus: parsed.data.learnedFromCorpus } : {}),
      metadata: parsed.data.evidence ? { evidence: parsed.data.evidence } : {},
    });
    return c.json({ success: true, data: { enabled: true, country: row } }, 200);
  });

  // POST /admin/jurisdictions/:code/disable — soft-disable.
  app.post('/:code/disable', async (c: any) => {
    if (!isPlatformAdmin(c)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'platform-admin only' } }, 403);
    }
    const code = c.req.param('code');
    if (!CODE_RX.test(code ?? '')) {
      return c.json({ success: false, error: { code: 'BAD_CODE', message: 'ISO-3166-1 alpha-2 required' } }, 400);
    }
    const svc = createEnabledJurisdictionsService(c.get('db'));
    await svc.disableCountry(code);
    return c.json({ success: true, data: { disabled: true, code: code.toUpperCase() } }, 200);
  });

  // POST /admin/jurisdictions/:code/ingest-compliance — THE LEARN-FEED.
  // Chunks a country's regulatory TEXT and writes each chunk into the SHARED
  // corpus (tenant_id = NULL) so every tenant inherits it; records provenance.
  app.post('/:code/ingest-compliance', async (c: any) => {
    if (!isPlatformAdmin(c)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'platform-admin only' } }, 403);
    }
    const code = c.req.param('code');
    if (!CODE_RX.test(code ?? '')) {
      return c.json({ success: false, error: { code: 'BAD_CODE', message: 'ISO-3166-1 alpha-2 required' } }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: { code: 'BAD_JSON', message: 'body must be JSON' } }, 400);
    }
    const parsed = IngestComplianceInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? 'invalid' } }, 400);
    }
    // Shared-corpus safety gate: the content is written tenant-agnostically, so
    // it MUST be public regulatory ground truth — refuse if the caller flags it
    // as anything else. (Default is regulatory for the admin/MD path.)
    if (parsed.data.isRegulatory === false) {
      return c.json({ success: false, error: { code: 'NON_REGULATORY', message: 'shared corpus accepts public regulatory content only — never tenant-private data or PII' } }, 422);
    }

    const upper = code.toUpperCase();
    const sourceFile = `${COMPLIANCE_SOURCE_PREFIX}${upper}`;
    const language = (parsed.data.language ?? 'en').slice(0, 5);
    const docTitle = parsed.data.title.trim();
    const chunks = chunkComplianceText(parsed.data.content);

    if (chunks.length === 0) {
      return c.json({ success: false, error: { code: 'EMPTY_CONTENT', message: 'content produced zero chunks' } }, 422);
    }

    const db = c.get('db');
    if (!db) {
      return c.json({ success: false, error: { code: 'NO_DB', message: 'database unavailable' } }, 503);
    }

    // No embedder is wired on this admin path — the corpus probe that
    // discover() runs is ILIKE/keyword over `text` + `source_file`, NOT
    // vector similarity, so text-only chunks are fully findable. We write
    // `embedding = NULL` (honest — never a faked vector); the nightly
    // borjie-corpus-ingest re-embedder can backfill semantic recall later.
    const ingestedAt = new Date();
    const rows = chunks.map((chunkText, index) => {
      // section = stable per-(doc,index) tag so re-ingesting the SAME document
      // REPLACES its chunks via the 0311 expression unique index
      // (COALESCE(tenant_id,''), source_file, COALESCE(section,'')) — idempotent.
      const section = `${docTitle} #${String(index + 1).padStart(4, '0')}`;
      const id = createHash('sha256')
        .update(`${sourceFile}::${section}`)
        .digest('hex')
        .slice(0, 32);
      return {
        id,
        tenantId: null as string | null,
        sourceFile,
        section,
        text: chunkText,
        embedding: null,
        url: parsed.data.sourceUrl ?? null,
        language,
        metadata: {
          jurisdiction: upper,
          doc_type: parsed.data.docType ?? 'compliance',
          doc_title: docTitle,
          source: 'admin_compliance_learn_feed',
          embedded: false,
        },
        ingestedAt,
      };
    });

    await db
      .insert(intelligenceCorpusChunks)
      .values(rows)
      .onConflictDoUpdate({
        // Must match migration 0311's expression index verbatim so re-ingest
        // overwrites rather than erroring/duplicating.
        target: sql`(COALESCE(tenant_id, ''), source_file, COALESCE(section, ''))`,
        set: {
          text: sql`excluded.text`,
          url: sql`excluded.url`,
          language: sql`excluded.language`,
          metadata: sql`excluded.metadata`,
          embedding: sql`excluded.embedding`,
          ingestedAt: sql`excluded.ingested_at`,
        },
      });

    // Provenance for the learn loop (compliance_doc_uploads, migration 0337).
    const auth = c.get('auth') ?? {};
    const svc = createEnabledJurisdictionsService(db);
    await svc.recordUpload({
      id: randomUUID(),
      countryCode: upper,
      ...(parsed.data.docType ? { docType: parsed.data.docType } : {}),
      ...(auth.userId ? { uploadedByAdminId: auth.userId as string } : {}),
      filePath: sourceFile,
      corpusChunkCount: rows.length,
      extractionStatus: 'ingested',
    });

    return c.json(
      {
        success: true,
        data: {
          ingested: true,
          chunks: rows.length,
          country: upper,
          source: sourceFile,
          embedded: false,
          note: 'text-only; semantic (vector) recall limited until re-embedded — keyword/ILIKE recall is live',
        },
      },
      200,
    );
  });

  return app;
}

export default createJurisdictionPromotionRouter;
