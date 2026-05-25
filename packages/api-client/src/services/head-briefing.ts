/**
 * Head Briefing API service — client wrapper for /api/v1/head/briefing.
 *
 * The router itself returns 503 HEAD_BRIEFING_UNAVAILABLE when the
 * composer is not wired (degraded mode). Each endpoint in this client
 * surfaces the underlying ApiResponse exactly as the gateway returns it
 * so callers can branch on `success` and render a graceful empty / retry
 * state instead of crashing the morning surface.
 *
 * Types mirror `@borjie/ai-copilot/head-briefing` so the UI can
 * render the document without re-deriving the shape.
 */

import { getApiClient, ApiResponse } from '../client';

/* ------------------------------------------------------------------------- */
/*  Briefing document — shape mirrors `@borjie/ai-copilot/head-briefing`. */
/*  Kept local so the UI does not pull the whole ai-copilot package into the */
/*  browser bundle.                                                          */
/* ------------------------------------------------------------------------- */

export type AutonomyDomainKey =
  | 'finance'
  | 'leasing'
  | 'maintenance'
  | 'compliance'
  | 'communications'
  | 'marketing'
  | 'hr'
  | 'procurement'
  | 'insurance'
  | 'legal_proceedings'
  | 'tenant_welfare';

export interface KpiDelta {
  readonly value: number;
  readonly delta7d: number;
}

export interface KpiDelta30d {
  readonly value: number;
  readonly delta30d: number;
}

export interface NotableAutonomousAction {
  readonly actionId: string;
  readonly domain: AutonomyDomainKey;
  readonly summary: string;
  readonly confidence: number;
}

export interface OvernightSection {
  readonly totalAutonomousActions: number;
  readonly byDomain: Partial<Record<AutonomyDomainKey, number>>;
  readonly notableActions: readonly NotableAutonomousAction[];
}

export interface PendingApprovalItem {
  readonly approvalId: string;
  readonly kind: 'single' | 'standing';
  readonly summary: string;
  readonly urgency: 'low' | 'medium' | 'high';
}

export interface PendingApprovalsSection {
  readonly count: number;
  readonly items: readonly PendingApprovalItem[];
}

export interface EscalationItem {
  readonly exceptionId: string;
  readonly priority: 'P1' | 'P2' | 'P3';
  readonly summary: string;
  readonly domain: string;
}

export interface EscalationsSection {
  readonly count: number;
  readonly byPriority: {
    readonly P1: number;
    readonly P2: number;
    readonly P3: number;
  };
  readonly items: readonly EscalationItem[];
}

export interface KpiDeltasSection {
  readonly occupancyPct: KpiDelta;
  readonly collectionsRate: KpiDelta;
  readonly arrearsDays: KpiDelta;
  readonly maintenanceSLA: KpiDelta;
  readonly tenantSatisfaction: KpiDelta30d;
  readonly noi: KpiDelta30d;
}

export interface BriefingRecommendation {
  readonly topic: string;
  readonly summary: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly suggestedAction: string;
}

export interface BriefingAnomaly {
  readonly area: string;
  readonly observation: string;
  readonly possibleCause: string;
  readonly suggestedInvestigation: string;
}

export interface BriefingDocument {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly headline: string;
  readonly overnight: OvernightSection;
  readonly pendingApprovals: PendingApprovalsSection;
  readonly escalations: EscalationsSection;
  readonly kpiDeltas: KpiDeltasSection;
  readonly recommendations: readonly BriefingRecommendation[];
  readonly anomalies: readonly BriefingAnomaly[];
}

/* ------------------------------------------------------------------------- */
/*  Service                                                                   */
/* ------------------------------------------------------------------------- */

const BASE = '/head/briefing';

export const headBriefingService = {
  /**
   * Fetch the full BriefingDocument for the authenticated head of
   * estates. The gateway resolves the tenant from the bearer token —
   * callers do not pass tenantId.
   */
  async getMyBriefing(): Promise<ApiResponse<BriefingDocument>> {
    return getApiClient().get<BriefingDocument>(BASE);
  },

  /**
   * Markdown rendering of the briefing — useful for email digests and
   * the share-to-team flow. Returns the raw markdown body in the
   * `data` field of an ApiResponse-shaped wrapper.
   */
  async getMyBriefingMarkdown(): Promise<ApiResponse<string>> {
    return getApiClient().get<string>(`${BASE}/markdown`);
  },

  /**
   * TTS-ready voice narration script for the briefing. Returned as
   * plain text in the ApiResponse data field.
   */
  async getMyBriefingVoiceScript(): Promise<ApiResponse<string>> {
    return getApiClient().get<string>(`${BASE}/voice-narration`);
  },
};
