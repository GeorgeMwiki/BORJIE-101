/**
 * /api/v1/internal/jurisdiction-discovery — JC-1 discovery loopback.
 *
 * Companion to:
 *   - services/api-gateway/src/composition/brain-tools/jurisdiction-discovery-tools.ts
 *     (the `mwikila.jurisdiction.discover` tool)
 *   - services/api-gateway/src/services/jurisdiction-discovery/
 *
 * The `mwikila.jurisdiction.discover` tool POSTed to
 * `/internal/jurisdiction-discovery/discover` over the loopback client, but
 * the discovery SERVICE — though fully built — was never composed or mounted
 * anywhere, so the route 404'd and the tool fell back to its low-confidence
 * stub on EVERY call. This router composes the real service (seed
 * short-circuit + corpus probe + cache) and lights the route up.
 *
 * Route (Supabase-JWT authed + tenant-bound):
 *   POST /discover   { country } → JurisdictionProfile + sources + promotionHint
 *
 * Probes wired here: the SEED short-circuit (curated #207 snapshot), the REAL
 * corpus probe over `intelligence_corpus_chunks` (global ground truth), and
 * the `discovered_jurisdictions` cache. The live WEB probe is intentionally a
 * no-op adapter here — the gateway must not read provider env outside the
 * bootstrap, and the service already degrades honestly to a corpus-or-seed
 * answer (never "I don't know", never fabricated). Promotion of the web probe
 * to the kernel's web-search tool is a registered follow-on.
 *
 * Honest-degrade: a missing DB still serves the seed/fallback profile so the
 * brain always has structure to render.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import {
  createJurisdictionDiscoveryService,
  createDrizzleDiscoveryCache,
  createDrizzleCorpusSearch,
  type BrainWebSearchAdapter,
} from '../../services/jurisdiction-discovery/index.js';

const discoveryLogger = createLogger('internal-jurisdiction-discovery');

const discoverSchema = z.object({
  tenantId: z.string().min(1).optional(),
  country: z.string().min(2).max(60),
});

/**
 * No-op web-search adapter. The corpus + seed probes carry discovery; the
 * live web probe is deferred (no env reads outside bootstrap). Returning `[]`
 * makes the service treat the web stream as "no hits" — it never fabricates.
 */
const NO_WEB_SEARCH: BrainWebSearchAdapter = {
  async search() {
    return [];
  },
};

/**
 * Map the service `DiscoveryResult` onto the brain-tool `DiscoverOutput`
 * wire shape (adds the user-facing `promotionHint`).
 */
function toWire(result: {
  profile: {
    countryCode: string;
    countryName: string;
    regulators: ReadonlyArray<{
      name: string;
      domain: 'mineral_licensing' | 'environment' | 'transparency' | 'audit' | 'unknown';
      mandate?: string;
      url?: string;
    }>;
    currency: string;
    languages: ReadonlyArray<string>;
    legalFramework?: string;
    validityScore: number;
  };
  sources: ReadonlyArray<{
    kind: 'web_search' | 'corpus' | 'fallback';
    id: string;
    title: string;
    snippet?: string;
  }>;
  origin: 'seed' | 'cache' | 'discovered' | 'fallback';
  lowConfidence: boolean;
}) {
  const promotionHint =
    result.origin === 'seed'
      ? 'This jurisdiction is part of the curated launch set.'
      : result.lowConfidence
        ? 'Discovery is degraded — once the web/corpus probes return verified detail I can offer to permanently add this jurisdiction (requires Borjie internal admin approval).'
        : 'I can offer to permanently add this jurisdiction to your launch set (requires Borjie internal admin approval).';
  return {
    countryCode: result.profile.countryCode,
    countryName: result.profile.countryName,
    regulators: result.profile.regulators.map((r) => ({
      name: r.name,
      domain: r.domain,
      ...(r.mandate ? { mandate: r.mandate } : {}),
      ...(r.url ? { url: r.url } : {}),
    })),
    currency: result.profile.currency,
    languages: [...result.profile.languages],
    ...(result.profile.legalFramework
      ? { legalFramework: result.profile.legalFramework }
      : {}),
    validityScore: result.profile.validityScore,
    origin: result.origin,
    lowConfidence: result.lowConfidence,
    sources: result.sources.map((s) => ({
      kind: s.kind,
      id: s.id,
      title: s.title,
      ...(s.snippet ? { snippet: s.snippet } : {}),
    })),
    promotionHint,
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// POST /discover — on-demand jurisdiction lookup (seed → cache → corpus probe).
app.post('/discover', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = discoverSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'country is required' } }, 400);
  }
  const db = c.get('db') ?? null;
  try {
    const service = createJurisdictionDiscoveryService({
      webSearch: NO_WEB_SEARCH,
      corpus: createDrizzleCorpusSearch(db),
      cache: createDrizzleDiscoveryCache(db),
    });
    const result = await service.discover(parsed.data.country);
    return c.json(toWire(result));
  } catch (err) {
    discoveryLogger.warn('jurisdiction discover degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    // Last-resort honest fallback — structure intact, low confidence, no
    // fabricated regulators beyond a best-effort label.
    const code = parsed.data.country.trim().slice(0, 2).toUpperCase() || 'XX';
    return c.json({
      countryCode: code,
      countryName: parsed.data.country,
      regulators: [
        { name: `${parsed.data.country} regulator (best-effort)`, domain: 'mineral_licensing' },
      ],
      currency: 'UNKNOWN',
      languages: ['en'],
      validityScore: 0.2,
      origin: 'fallback',
      lowConfidence: true,
      sources: [],
      promotionHint:
        'Discovery is degraded — once the system reconnects I can verify these details and offer to permanently add this jurisdiction (requires Borjie internal admin approval).',
    });
  }
});

export const internalJurisdictionDiscoveryRouter = app;
export default internalJurisdictionDiscoveryRouter;
