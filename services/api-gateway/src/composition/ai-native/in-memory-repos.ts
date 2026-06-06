/**
 * In-memory persistence repos for the AI-native PhL features — FALLBACK ONLY.
 *
 * The durable path now exists: the PhL doc-intelligence, dynamic-pricing, and
 * legal-drafter persistence ports (`DocIntelligenceRepository`,
 * `PriceRecommendationRepository`, `LegalDraftRepository`) are backed by
 * FORCE-RLS tenant-scoped Postgres tables — `document_entities` /
 * `document_obligations`, `price_recommendations`, and a PhL-shaped
 * `legal_drafts` (migrations 0287-0289), with Drizzle schemas in
 * `@borjie/database` and Drizzle repos in `ai-native/drizzle-repos.ts`.
 * `ai-native-wiring.ts` selects the Drizzle repos whenever a DB client is
 * present.
 *
 * These in-process maps remain as the fallback for the no-DB / test boot path
 * (when `deps.db` is null), so the routes stay fully functional within a
 * process lifetime even without Postgres — an `extract`/`draft` write is
 * readable by the matching `GET .../entities`, `.../obligations`, and
 * `/legal-drafts` reads — but records do NOT survive a restart and are NOT
 * shared across replicas in that mode.
 *
 * Tenant isolation is enforced in code: every read filters by `tenantId` and a
 * record is only ever returned to the tenant that wrote it — mirroring the RLS
 * posture the durable tables FORCE-enable.
 */

import {
  DocIntelligence as DocIntelligenceNs,
  DynamicPricing as DynamicPricingNs,
  LegalDrafter as LegalDrafterNs,
} from '@borjie/ai-copilot/ai-native';

type DocIntelligenceRepository = DocIntelligenceNs.DocIntelligenceRepository;
type ExtractedEntity = DocIntelligenceNs.ExtractedEntity;
type ExtractedObligation = DocIntelligenceNs.ExtractedObligation;

type PriceRecommendationRepository =
  DynamicPricingNs.PriceRecommendationRepository;
type PriceRecommendation = DynamicPricingNs.PriceRecommendation;

type LegalDraftRepository = LegalDrafterNs.LegalDraftRepository;
type LegalDraftRow = LegalDrafterNs.LegalDraftRow;
type LegalDocumentKind = LegalDrafterNs.LegalDocumentKind;

/** Compose a stable per-tenant + per-document key. */
function docKey(tenantId: string, documentId: string): string {
  return `${tenantId}::${documentId}`;
}

// ---------------------------------------------------------------------------
// DocIntelligenceRepository
// ---------------------------------------------------------------------------

export function createInMemoryDocIntelligenceRepo(): DocIntelligenceRepository {
  const entitiesByDoc = new Map<string, ExtractedEntity[]>();
  const obligationsByDoc = new Map<string, ExtractedObligation[]>();

  return {
    async insertEntities(rows) {
      for (const row of rows) {
        const key = docKey(row.tenantId, row.documentId);
        const bucket = entitiesByDoc.get(key) ?? [];
        entitiesByDoc.set(key, [...bucket, row]);
      }
    },
    async insertObligations(rows) {
      for (const row of rows) {
        const key = docKey(row.tenantId, row.documentId);
        const bucket = obligationsByDoc.get(key) ?? [];
        obligationsByDoc.set(key, [...bucket, row]);
      }
    },
    async listEntities(tenantId, documentId) {
      const bucket = entitiesByDoc.get(docKey(tenantId, documentId)) ?? [];
      // Defensive tenant re-check (records are keyed by tenant, but never
      // leak another tenant's row even on a key collision).
      return Object.freeze(bucket.filter((e) => e.tenantId === tenantId));
    },
    async listObligations(tenantId, documentId) {
      const bucket = obligationsByDoc.get(docKey(tenantId, documentId)) ?? [];
      return Object.freeze(bucket.filter((o) => o.tenantId === tenantId));
    },
  };
}

// ---------------------------------------------------------------------------
// PriceRecommendationRepository
// ---------------------------------------------------------------------------

export function createInMemoryPriceRecommendationRepo(): PriceRecommendationRepository {
  // Keyed by tenant -> pit -> recommendations (newest first).
  const byTenantPit = new Map<string, PriceRecommendation[]>();

  function pitKey(tenantId: string, pitId: string): string {
    return `${tenantId}::${pitId}`;
  }

  return {
    async insert(row) {
      const key = pitKey(row.tenantId, row.pitId);
      const bucket = byTenantPit.get(key) ?? [];
      byTenantPit.set(key, [row, ...bucket]);
      return row;
    },
    async listByPit(tenantId, pitId, limit) {
      const bucket = byTenantPit.get(pitKey(tenantId, pitId)) ?? [];
      const scoped = bucket.filter((r) => r.tenantId === tenantId);
      return Object.freeze(
        typeof limit === 'number' ? scoped.slice(0, limit) : scoped,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// LegalDraftRepository
// ---------------------------------------------------------------------------

export function createInMemoryLegalDraftRepo(): LegalDraftRepository {
  const byTenant = new Map<string, LegalDraftRow[]>();

  return {
    async insert(row) {
      const bucket = byTenant.get(row.tenantId) ?? [];
      byTenant.set(row.tenantId, [row, ...bucket]);
      return row;
    },
    async list(tenantId, filter) {
      const bucket = (byTenant.get(tenantId) ?? []).filter(
        (r) => r.tenantId === tenantId,
      );
      const kind = filter?.documentKind as LegalDocumentKind | undefined;
      const filtered = kind
        ? bucket.filter((r) => r.documentKind === kind)
        : bucket;
      return Object.freeze(
        typeof filter?.limit === 'number'
          ? filtered.slice(0, filter.limit)
          : filtered,
      );
    },
  };
}
