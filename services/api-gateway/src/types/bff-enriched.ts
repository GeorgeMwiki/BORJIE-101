/**
 * BFF Enriched Composite Types — KI-DEBT-003 closure.
 *
 * The owner-portal BFF returns composite envelopes (owner brief + recent
 * decisions + reminders + pinned items + scope tree + per-domain
 * compliance digests + invitation receipts, etc.). Pre-2026-05-29 each
 * handler typed its payload with `any` because no shared envelope shape
 * existed; this file centralises every leaf + composite type so the
 * `c.json(payload)` boundary is fully typed.
 *
 * Design notes:
 *   - Every type composes from smaller leaf types — no per-handler mega
 *     types — so a new handler reuses `ApiSuccess<T>` / `ApiEmpty<T>` /
 *     `BffMeta` without reinventing the envelope.
 *   - The `success: true | false` discriminant matches the runtime shape
 *     emitted by `utils/error-response.ts`.
 *   - Honest-empty endpoints return `{ success: true; data: T; meta? }`
 *     where `data` is intentionally empty (`[]` / zeroed numbers) and
 *     `meta.note` carries a human-readable reason. The route layer
 *     should never silently drop a meta.note — observability depends on
 *     it.
 *   - Wide repo / service surfaces (`OwnerScopeRepos`, `FeatureFlagsPort`,
 *     `InvitationServicePort`) are intentionally structural so test
 *     fakes and the live composition root agree without re-exporting
 *     concrete classes.
 */
import type { Context } from 'hono';

import type {
  OwnerAuthContext,
  OwnerScopeRepos,
} from '../lib/owner-scope';

// ---------------------------------------------------------------------------
// Envelope primitives
// ---------------------------------------------------------------------------

/**
 * Honest-empty metadata. Every endpoint that returns an intentionally
 * empty payload (because the underlying domain service isn't wired yet)
 * carries a `note` describing why so observers and the UI both render
 * the gap explicitly.
 */
export interface BffMeta {
  readonly note: string;
}

/** Successful response envelope. */
export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: BffMeta;
}

/** Successful response envelope with always-present meta (honest-empty). */
export interface ApiSuccessWithMeta<T> {
  readonly success: true;
  readonly data: T;
  readonly meta: BffMeta;
}

/** Cursor-paginated response envelope. */
export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Owner brief + dashboard composites
// ---------------------------------------------------------------------------

/**
 * Severity tiers used across reminders, risks, and inspections so the UI
 * can colour-coded rows with a single shared scale.
 */
export type SeverityTier = 'low' | 'medium' | 'high' | 'critical';

/** Decision retrospective grade (post-outcome). */
export type DecisionGrade = 'A' | 'B' | 'C' | 'D' | 'F' | null;

/**
 * Enriched reminder — base row + computed urgency + owner-context flag.
 * Computed fields live alongside the raw columns so the FE renders
 * without a second join.
 */
export interface EnrichedReminder {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly triggerAt: string;
  readonly channel: 'email' | 'sms' | 'slack' | 'in-app';
  readonly status: 'pending' | 'fired' | 'snoozed' | 'cancelled';
  /** Minutes until trigger; negative when overdue. */
  readonly minutesUntilTrigger: number;
  readonly urgency: SeverityTier;
  /** True when the reminder is pinned to the owner's quick-access strip. */
  readonly ownerPinned: boolean;
}

/**
 * Enriched decision — chosen value + alternatives + rationale +
 * retrospective grade (NULL until the worker rates it).
 */
export interface EnrichedDecision {
  readonly id: string;
  readonly tenantId: string;
  readonly chosenValue: string;
  readonly rationale: string;
  readonly alternatives: readonly string[];
  readonly confidence: number; // 0..1
  readonly grade: DecisionGrade;
  readonly decidedAt: string;
  readonly retrospectiveAt?: string;
}

/**
 * Enriched draft (contract / RFP / letter / notice / memo) with lock
 * status + revision count + size for the drafts strip.
 */
export interface EnrichedDraft {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: 'contract' | 'rfp' | 'letter' | 'notice' | 'memo';
  readonly title: string;
  readonly locked: boolean;
  readonly lockedBy?: string;
  readonly revisionCount: number;
  readonly sizeBytes: number;
  readonly updatedAt: string;
}

/** Enriched dashboard tab — last-viewed + pinned flag for tab-as-loop. */
export interface EnrichedTab {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly lastViewedAt?: string;
  readonly ownerPinned: boolean;
}

/** Enriched opportunity — confidence + projected value in TZS. */
export interface EnrichedOpportunity {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly confidence: number; // 0..1
  readonly projectedValueTzs: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

/** Enriched risk — severity tier + days-until-impact. */
export interface EnrichedRisk {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly severity: SeverityTier;
  readonly daysUntilImpact: number;
  readonly mitigations: readonly string[];
}

/** Pinned item — shared by the owner's quick-access strip. */
export interface EnrichedPinnedItem {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: 'tab' | 'reminder' | 'decision' | 'draft' | 'opportunity';
  readonly targetId: string;
  readonly label: string;
  readonly pinnedAt: string;
}

/** Recursive scope node (sites / pits / shafts / etc.). */
export interface ScopeNodeWithChildren {
  readonly id: string;
  readonly tenantId: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly label: string;
  readonly children: readonly ScopeNodeWithChildren[];
}

/** Plain owner brief snapshot. */
export interface OwnerBrief {
  readonly id: string;
  readonly tenantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly summary: string;
  readonly createdAt: string;
}

/**
 * Composite enriched owner brief — what the owner-portal home screen
 * renders in one round-trip.
 */
export interface OwnerBriefEnriched {
  readonly brief: OwnerBrief;
  readonly reminders: readonly EnrichedReminder[];
  readonly recentDecisions: readonly EnrichedDecision[];
  readonly pinnedItems: readonly EnrichedPinnedItem[];
  readonly activeOpportunities: readonly EnrichedOpportunity[];
  readonly activeRisks: readonly EnrichedRisk[];
}

/** Owner dashboard snapshot — brief + tabs + scope tree. */
export interface OwnerDashboardSnapshot {
  readonly brief: OwnerBriefEnriched;
  readonly tabs: readonly EnrichedTab[];
  readonly scopeTree: readonly ScopeNodeWithChildren[];
}

// ---------------------------------------------------------------------------
// Co-owner directory
// ---------------------------------------------------------------------------

/** Single co-owner row returned by `repos.userPropertyAccess.findCoOwners`. */
export interface CoOwnerRow {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly propertyAccess: readonly string[];
  readonly addedAt: string;
}

/** Co-owners endpoint port — narrows to just the method this BFF calls. */
export interface CoOwnersPort {
  findCoOwners(
    tenantId: string,
    propertyAccess: readonly string[],
  ): Promise<readonly CoOwnerRow[]>;
}

/**
 * Subset of `c.get('repos')` consumed by the BFF. The composition root's
 * full container exposes far more; we surface only the slot this file
 * touches so unrelated repos don't have to be plumbed through fakes.
 */
export interface OwnerBffRepos {
  readonly userPropertyAccess?: CoOwnersPort;
}

// ---------------------------------------------------------------------------
// Compliance digests
// ---------------------------------------------------------------------------

export interface BudgetsSummary {
  readonly totalBudgetMajor: number;
  readonly spentMajor: number;
  readonly varianceMajor: number;
  readonly currency: string;
  readonly meta: BffMeta;
}

export interface BudgetsForecasts {
  readonly forecasts: readonly never[];
  readonly meta: BffMeta;
}

/** Aggregate counts surfaced on the compliance dashboard tile. */
export interface ComplianceSummary {
  readonly inspectionsDueCount: number;
  readonly insuranceExpiringCount: number;
  readonly licensesExpiringCount: number;
  readonly meta: BffMeta;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/** Payload signed into the invitation HMAC token. */
export interface InvitationTokenPayload {
  readonly invitationId: string;
  readonly email: string;
  readonly role: 'co-owner';
  readonly propertyAccess: readonly string[];
  readonly invitedBy: string;
  readonly tenantId: string;
  readonly expiresAt: string;
}

/** Args passed to `services.invitationService.create`. */
export interface InvitationCreateArgs extends InvitationTokenPayload {
  readonly token: string;
}

/** Shape returned by `services.invitationService.create`. */
export interface InvitationCreatedRow {
  readonly invitationId: string;
  readonly email: string;
  readonly role: 'co-owner';
  readonly propertyAccess: readonly string[];
  readonly invitedBy: string;
  readonly tenantId: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'cancelled';
  readonly createdAt: string;
}

/**
 * Service-port for invitation persistence. Composition root may wire a
 * concrete class; the BFF only relies on this narrow contract.
 */
export interface InvitationServicePort {
  create(args: InvitationCreateArgs): Promise<InvitationCreatedRow>;
}

/** Service-port for feature-flag isEnabled. */
export interface FeatureFlagsPort {
  isEnabled(tenantId: string, flagKey: string): Promise<boolean>;
}

/** Subset of `c.get('services')` consumed by the BFF. */
export interface OwnerBffServices {
  readonly invitationService?: InvitationServicePort;
  readonly featureFlags?: FeatureFlagsPort;
}

/** Successful invitation receipt — server-side flag path. */
export interface InvitationReceipt {
  readonly invitationId: string;
  readonly expiresAt: string;
  readonly token: string;
  readonly meta?: BffMeta;
}

/** Receipt returned when the persistence service is wired. */
export type InvitationServiceReceipt = InvitationCreatedRow & {
  readonly token: string;
};

/** Cancel-invitation receipt. */
export interface InvitationCancelReceipt {
  readonly id: string;
  readonly status: 'cancelled';
  readonly meta: BffMeta;
}

// ---------------------------------------------------------------------------
// Helpers / re-exports
// ---------------------------------------------------------------------------

/**
 * Convenience alias — every owner-portal handler receives a Hono context
 * carrying the augmented `ContextVariableMap`. Routes that need to type
 * a helper that takes the context import this directly to avoid restating
 * the Hono.Env generic.
 */
export type OwnerBffContext = Context;

// Re-export the owner-scope domain types so handlers in this file have a
// single import path for both envelope + scope wiring concerns.
export type { OwnerAuthContext, OwnerScopeRepos };
