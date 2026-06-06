/**
 * Drizzle-backed persistence repos for the AI-native PhL features.
 *
 * These replace the in-process maps in `in-memory-repos.ts` once the durable
 * tables land (migrations 0287-0289). They implement the SAME three ports as
 * the in-memory repos — `PriceRecommendationRepository`,
 * `DocIntelligenceRepository`, `LegalDraftRepository` from
 * `@borjie/ai-copilot/ai-native` — so swapping them in `ai-native-wiring.ts`
 * touches only the repo construction, never the service factories or routes.
 *
 * Tenant isolation is enforced in TWO layers:
 *   1. RLS — every table FORCE-enables row-level security on the canonical
 *      `app.current_tenant_id` GUC, which the api-gateway databaseMiddleware
 *      binds per request. A write/read for the wrong tenant is rejected by
 *      Postgres regardless of what this code does.
 *   2. Defence-in-depth — every read here ALSO filters by the caller-supplied
 *      `tenantId` (mirrors the in-memory repos' "defensive tenant re-check"),
 *      and every insert carries `tenantId` on the row.
 *
 * Insert returns the row the caller passed (the persisted shape is identical —
 * the service already assigned the id, createdAt, etc.), mirroring the
 * `voice-turns` / `cost-ledger` Drizzle repos. No `console.log` — failures are
 * logged via the shared Pino logger and rethrown so the route surfaces a clean
 * error envelope.
 *
 * The Drizzle client is typed `DrizzleLike` (`any`) at the seam: the fluent
 * builder generics cannot be reproduced through the `@borjie/database` package
 * barrel without tripping `TS2709` (see `cost-ledger-repository.ts` for the full
 * rationale). Every row is cast to `Record<string, unknown>` before it is read,
 * so the rest of the file stays typed.
 */

import { and, desc, eq } from 'drizzle-orm';
import {
  priceRecommendations,
  documentEntities,
  documentObligations,
  legalDrafts,
} from '@borjie/database';
import {
  DocIntelligence as DocIntelligenceNs,
  DynamicPricing as DynamicPricingNs,
  LegalDrafter as LegalDrafterNs,
} from '@borjie/ai-copilot/ai-native';

import { logger } from '../../utils/logger.js';

type DocIntelligenceRepository = DocIntelligenceNs.DocIntelligenceRepository;
type ExtractedEntity = DocIntelligenceNs.ExtractedEntity;
type ExtractedObligation = DocIntelligenceNs.ExtractedObligation;

type PriceRecommendationRepository =
  DynamicPricingNs.PriceRecommendationRepository;
type PriceRecommendation = DynamicPricingNs.PriceRecommendation;

type LegalDraftRepository = LegalDrafterNs.LegalDraftRepository;
type LegalDraftRow = LegalDrafterNs.LegalDraftRow;
type LegalDocumentKind = LegalDrafterNs.LegalDocumentKind;

/**
 * Drizzle client shape — `any` at this single seam (see file header). Callers
 * pass the real `DatabaseClient` (`ReturnType<typeof createDatabaseClient>`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleLike = any;

/** Convert a Drizzle `timestamptz` value (Date | string) to an ISO string. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : new Date().toISOString();
}

/** Convert a Drizzle `date` value to a 'YYYY-MM-DD' string (or null). */
function toDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.slice(0, 10);
  }
  return typeof value === 'string' ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

// ---------------------------------------------------------------------------
// PriceRecommendationRepository
// ---------------------------------------------------------------------------

function priceRowToRecommendation(
  row: Record<string, unknown>,
): PriceRecommendation {
  const citations = Array.isArray(row.citations)
    ? (row.citations as PriceRecommendation['citations'])
    : [];
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    pitId: String(row.pitId),
    siteId: (row.siteId as string | null) ?? null,
    currencyCode: String(row.currencyCode),
    currentPriceMinor: Number(row.currentPriceMinor) || 0,
    recommendedPriceMinor: Number(row.recommendedPriceMinor) || 0,
    deltaPct: Number(row.deltaPct) || 0,
    confidence: Number(row.confidence) || 0,
    suggestedReviewDate: toDateString(row.suggestedReviewDate) ?? '',
    citations,
    regulatoryCapPct: toNullableNumber(row.regulatoryCapPct),
    capBreached: Boolean(row.capBreached),
    explanation: (row.explanation as string | null) ?? '',
    modelVersion: String(row.modelVersion ?? ''),
    promptHash: String(row.promptHash ?? ''),
    status: 'proposed',
    createdAt: toIso(row.createdAt),
  };
}

export function createDrizzlePriceRecommendationRepo(
  db: DrizzleLike,
): PriceRecommendationRepository {
  return {
    async insert(row) {
      if (!row.tenantId || !row.id || !row.pitId) {
        throw new Error(
          'price-recommendation.insert requires tenantId, id, and pitId',
        );
      }
      try {
        await db.insert(priceRecommendations).values({
          id: row.id,
          tenantId: row.tenantId,
          pitId: row.pitId,
          siteId: row.siteId,
          currencyCode: row.currencyCode,
          currentPriceMinor: row.currentPriceMinor,
          recommendedPriceMinor: row.recommendedPriceMinor,
          deltaPct: row.deltaPct,
          confidence: row.confidence,
          suggestedReviewDate: row.suggestedReviewDate,
          citations: row.citations,
          regulatoryCapPct: row.regulatoryCapPct,
          capBreached: row.capBreached,
          explanation: row.explanation,
          modelVersion: row.modelVersion,
          promptHash: row.promptHash,
          status: row.status,
          createdAt: new Date(row.createdAt),
        });
        return row;
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'price-recommendation.insert failed',
        );
        throw error instanceof Error
          ? error
          : new Error('price-recommendation.insert failed');
      }
    },

    async listByPit(tenantId, pitId, limit) {
      if (!tenantId || !pitId) return Object.freeze([]);
      try {
        const base = db
          .select()
          .from(priceRecommendations)
          .where(
            and(
              eq(priceRecommendations.tenantId, tenantId),
              eq(priceRecommendations.pitId, pitId),
            ),
          )
          .orderBy(desc(priceRecommendations.createdAt));
        const rows = (await (typeof limit === 'number'
          ? base.limit(limit)
          : base)) as Record<string, unknown>[];
        return Object.freeze(rows.map(priceRowToRecommendation));
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'price-recommendation.listByPit failed',
        );
        return Object.freeze([]);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// DocIntelligenceRepository
// ---------------------------------------------------------------------------

function entityRowToExtracted(row: Record<string, unknown>): ExtractedEntity {
  const normalized =
    row.normalizedForm && typeof row.normalizedForm === 'object'
      ? (row.normalizedForm as Readonly<Record<string, unknown>>)
      : {};
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    documentId: String(row.documentId),
    entityKind: row.entityKind as ExtractedEntity['entityKind'],
    entityValue: String(row.entityValue ?? ''),
    ...(row.entityRaw != null ? { entityRaw: String(row.entityRaw) } : {}),
    normalizedForm: normalized,
    languageCode: (row.languageCode as string | null) ?? null,
    spanStart: toNullableNumber(row.spanStart),
    spanEnd: toNullableNumber(row.spanEnd),
    confidence: toNullableNumber(row.confidence),
    embeddingRef: (row.embeddingRef as string | null) ?? null,
    modelVersion: String(row.modelVersion ?? ''),
    promptHash: String(row.promptHash ?? ''),
    createdAt: toIso(row.createdAt),
  };
}

function obligationRowToExtracted(
  row: Record<string, unknown>,
): ExtractedObligation {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    documentId: String(row.documentId),
    obligor: String(row.obligor ?? ''),
    obligee: (row.obligee as string | null) ?? null,
    actionSummary: String(row.actionSummary ?? ''),
    dueDate: toDateString(row.dueDate),
    recurrence: (row.recurrence as string | null) ?? null,
    consequenceIfMissed: (row.consequenceIfMissed as string | null) ?? null,
    riskFlags: toStringArray(row.riskFlags),
    languageCode: (row.languageCode as string | null) ?? null,
    spanStart: toNullableNumber(row.spanStart),
    spanEnd: toNullableNumber(row.spanEnd),
    confidence: toNullableNumber(row.confidence),
    modelVersion: String(row.modelVersion ?? ''),
    promptHash: String(row.promptHash ?? ''),
    explanation: (row.explanation as string | null) ?? null,
    createdAt: toIso(row.createdAt),
  };
}

export function createDrizzleDocIntelligenceRepo(
  db: DrizzleLike,
): DocIntelligenceRepository {
  return {
    async insertEntities(rows) {
      if (rows.length === 0) return;
      try {
        const values = rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          documentId: row.documentId,
          entityKind: row.entityKind,
          entityValue: row.entityValue,
          entityRaw: row.entityRaw ?? null,
          normalizedForm: row.normalizedForm,
          languageCode: row.languageCode,
          spanStart: row.spanStart,
          spanEnd: row.spanEnd,
          confidence: row.confidence,
          embeddingRef: row.embeddingRef,
          modelVersion: row.modelVersion,
          promptHash: row.promptHash,
          createdAt: new Date(row.createdAt),
        }));
        await db.insert(documentEntities).values(values);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'doc-intelligence.insertEntities failed',
        );
        throw error instanceof Error
          ? error
          : new Error('doc-intelligence.insertEntities failed');
      }
    },

    async insertObligations(rows) {
      if (rows.length === 0) return;
      try {
        const values = rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          documentId: row.documentId,
          obligor: row.obligor,
          obligee: row.obligee,
          actionSummary: row.actionSummary,
          dueDate: row.dueDate,
          recurrence: row.recurrence,
          consequenceIfMissed: row.consequenceIfMissed,
          riskFlags: row.riskFlags,
          languageCode: row.languageCode,
          spanStart: row.spanStart,
          spanEnd: row.spanEnd,
          confidence: row.confidence,
          modelVersion: row.modelVersion,
          promptHash: row.promptHash,
          explanation: row.explanation,
          createdAt: new Date(row.createdAt),
        }));
        await db.insert(documentObligations).values(values);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'doc-intelligence.insertObligations failed',
        );
        throw error instanceof Error
          ? error
          : new Error('doc-intelligence.insertObligations failed');
      }
    },

    async listEntities(tenantId, documentId) {
      if (!tenantId || !documentId) return Object.freeze([]);
      try {
        const rows = (await db
          .select()
          .from(documentEntities)
          .where(
            and(
              eq(documentEntities.tenantId, tenantId),
              eq(documentEntities.documentId, documentId),
            ),
          )) as Record<string, unknown>[];
        return Object.freeze(rows.map(entityRowToExtracted));
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'doc-intelligence.listEntities failed',
        );
        return Object.freeze([]);
      }
    },

    async listObligations(tenantId, documentId) {
      if (!tenantId || !documentId) return Object.freeze([]);
      try {
        const rows = (await db
          .select()
          .from(documentObligations)
          .where(
            and(
              eq(documentObligations.tenantId, tenantId),
              eq(documentObligations.documentId, documentId),
            ),
          )) as Record<string, unknown>[];
        return Object.freeze(rows.map(obligationRowToExtracted));
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'doc-intelligence.listObligations failed',
        );
        return Object.freeze([]);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// LegalDraftRepository
// ---------------------------------------------------------------------------

function legalRowToDraft(row: Record<string, unknown>): LegalDraftRow {
  const jurisdiction =
    row.jurisdictionMetadata && typeof row.jurisdictionMetadata === 'object'
      ? (row.jurisdictionMetadata as Readonly<Record<string, unknown>>)
      : {};
  const context =
    row.context && typeof row.context === 'object'
      ? (row.context as Readonly<Record<string, unknown>>)
      : {};
  const citations = Array.isArray(row.citations)
    ? (row.citations as LegalDraftRow['citations'])
    : [];
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    documentKind: row.documentKind as LegalDocumentKind,
    countryCode: String(row.countryCode ?? ''),
    jurisdictionMetadata: jurisdiction,
    subjectCustomerId: (row.subjectCustomerId as string | null) ?? null,
    subjectOfftakeId: (row.subjectOfftakeId as string | null) ?? null,
    subjectSiteId: (row.subjectSiteId as string | null) ?? null,
    subjectPitId: (row.subjectPitId as string | null) ?? null,
    languageCode: (row.languageCode as string | null) ?? null,
    draftTitle: String(row.draftTitle ?? ''),
    draftBody: String(row.draftBody ?? ''),
    requiredClauses: toStringArray(row.requiredClauses),
    legalCitations: toStringArray(row.legalCitations),
    reviewFlags: toStringArray(row.reviewFlags),
    needsHumanReview: Boolean(row.needsHumanReview),
    status: 'draft',
    autonomyDecision: row.autonomyDecision as LegalDraftRow['autonomyDecision'],
    modelVersion: String(row.modelVersion ?? ''),
    promptHash: String(row.promptHash ?? ''),
    confidence: Number(row.confidence) || 0,
    context,
    createdBy: (row.createdBy as string | null) ?? null,
    createdAt: toIso(row.createdAt),
    citations,
  };
}

export function createDrizzleLegalDraftRepo(
  db: DrizzleLike,
): LegalDraftRepository {
  return {
    async insert(row) {
      if (!row.tenantId || !row.id) {
        throw new Error('legal-draft.insert requires tenantId and id');
      }
      try {
        await db.insert(legalDrafts).values({
          id: row.id,
          tenantId: row.tenantId,
          documentKind: row.documentKind,
          countryCode: row.countryCode,
          jurisdictionMetadata: row.jurisdictionMetadata,
          subjectCustomerId: row.subjectCustomerId,
          subjectOfftakeId: row.subjectOfftakeId,
          subjectSiteId: row.subjectSiteId,
          subjectPitId: row.subjectPitId,
          languageCode: row.languageCode,
          draftTitle: row.draftTitle,
          draftBody: row.draftBody,
          requiredClauses: row.requiredClauses,
          legalCitations: row.legalCitations,
          reviewFlags: row.reviewFlags,
          needsHumanReview: row.needsHumanReview,
          status: row.status,
          autonomyDecision: row.autonomyDecision,
          modelVersion: row.modelVersion,
          promptHash: row.promptHash,
          confidence: row.confidence,
          context: row.context,
          citations: row.citations,
          createdBy: row.createdBy,
          createdAt: new Date(row.createdAt),
        });
        return row;
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'legal-draft.insert failed',
        );
        throw error instanceof Error
          ? error
          : new Error('legal-draft.insert failed');
      }
    },

    async list(tenantId, filter) {
      if (!tenantId) return Object.freeze([]);
      try {
        const kind = filter?.documentKind;
        const where = kind
          ? and(
              eq(legalDrafts.tenantId, tenantId),
              eq(legalDrafts.documentKind, kind),
            )
          : eq(legalDrafts.tenantId, tenantId);
        const base = db
          .select()
          .from(legalDrafts)
          .where(where)
          .orderBy(desc(legalDrafts.createdAt));
        const rows = (await (typeof filter?.limit === 'number'
          ? base.limit(filter.limit)
          : base)) as Record<string, unknown>[];
        return Object.freeze(rows.map(legalRowToDraft));
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'legal-draft.list failed',
        );
        return Object.freeze([]);
      }
    },
  };
}
