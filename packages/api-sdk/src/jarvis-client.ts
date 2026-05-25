/**
 * @borjie/api-sdk — Jarvis client.
 *
 * Typed POST helpers for the per-user Jarvis surfaces exposed by the
 * api-gateway:
 *
 *   /api/v1/customer/jarvis/*    — tenant residents
 *   /api/v1/owner/jarvis/*       — property owners
 *   /api/v1/manager/jarvis/*     — estate managers
 *   /api/v1/admin/jarvis/*       — agency admins
 *   /api/v1/platform/jarvis/*    — Borjie HQ employees
 *
 * Each frontend (customer-app, owner-portal, estate-manager-app,
 * admin-portal, admin-web) wraps this client with its
 * surface prefix and uses the same call shapes.
 */

import type { BossnyumbaClient } from './client.js';
import {
  createJarvisStream,
  type JarvisStreamHandle,
} from './jarvis-stream.js';

/**
 * Jarvis surface — names the seat the requester sits in.
 *
 * Mirrors LITFIN's tiered AI mapping, scoped to property:
 *   'customer'  ↔ LITFIN borrower         (tenant resident)
 *   'manager'   ↔ LITFIN officer          (estate manager)
 *   'owner'     ↔ LITFIN bank/org admin   (owner — IS the admin)
 *   'platform'  ↔ LITFIN HQ internal      (Borjie HQ)
 *
 * `'admin'` is kept as a deprecated alias of `'owner'` for backwards
 * compatibility with the legacy `apps/admin-portal/`. New consumers
 * should use `'owner'`. See `apps/admin-portal/DEPRECATED.md`.
 */
export type JarvisSurface =
  | 'customer'
  | 'owner'
  | 'manager'
  /** @deprecated alias of `'owner'` — owners are the admins */
  | 'admin'
  | 'platform';

export type JarvisTier =
  | 'tenant' | 'lease' | 'unit' | 'block'
  | 'property' | 'portfolio' | 'org' | 'industry';

export type JarvisStakes = 'low' | 'medium' | 'high' | 'critical';
export type JarvisSeverity = 'info' | 'warn' | 'urgent';
export type JarvisApprovalStatus =
  | 'pending' | 'one-eye' | 'approved' | 'rejected' | 'expired';

/**
 * Feedback signal kind. Mirrors the kernel's `FeedbackSignal` so the
 * SDK and the brain agree on the wire shape one-for-one. The
 * `correction` signal SHOULD be paired with a verbatim
 * `correctionText` so the next kernel turn can apologise / adjust.
 */
export type FeedbackSignal =
  | 'thumbs-up'
  | 'thumbs-down'
  | 'correction'
  | 'flagged';

/**
 * Optional category bucket for `thumbs-down` / `correction` /
 * `flagged` signals. The kernel rolls these up into a per-category
 * negative-rate the model sees on the next turn (e.g. "you flagged
 * 2 of my 14 recent answers as 'hallucinated' — be especially
 * careful about citations").
 */
export type FeedbackCategory =
  | 'hallucinated'
  | 'incomplete'
  | 'wrong-tone'
  | 'unhelpful'
  | 'great'
  | 'other';

export interface JarvisRecordFeedbackRequest {
  /** Provenance id of the kernel turn being rated. */
  readonly thoughtId: string;
  /** Thread id the rated turn belongs to. */
  readonly threadId: string;
  readonly signal: FeedbackSignal;
  /** Optional 1..5 numeric rating; clamped server-side. */
  readonly rating?: number;
  /** User's "this is wrong because…" verbatim text. */
  readonly correctionText?: string;
  readonly category?: FeedbackCategory | string;
}

/**
 * Multimodal attachment for {@link JarvisThinkRequest}. Mirrors the
 * kernel's `ThoughtAttachment` shape — base64-encoded image bytes the
 * gateway forwards to a vision-capable Sensor (Claude Opus / Sonnet /
 * Haiku).
 */
export interface JarvisAttachment {
  readonly kind: 'image';
  readonly mediaType:
    | 'image/png'
    | 'image/jpeg'
    | 'image/gif'
    | 'image/webp';
  /** Base64-encoded image bytes (NO data-URL prefix). */
  readonly data: string;
  /** Optional filename / caption used for audit + UI display. */
  readonly caption?: string;
}

export interface JarvisThinkRequest {
  readonly threadId: string;
  readonly userMessage: string;
  readonly tier?: JarvisTier;
  readonly stakes?: JarvisStakes;
  readonly requireJudge?: boolean;
  /**
   * Optional multimodal attachments (lease scans, property photos,
   * damage assessment images). The gateway enforces a per-turn cap of
   * 10 attachments and a per-attachment cap of 4 MB base64-decoded.
   */
  readonly attachments?: ReadonlyArray<JarvisAttachment>;
}

export interface JarvisDecision {
  readonly kind: 'answer' | 'softened' | 'refusal';
  readonly text?: string;
  readonly hedge?: string;
  readonly reason?: string;
  /**
   * Populated only on `kind: 'refusal'`. Names the gate layer that
   * blocked the turn (`'inviolable' | 'policy' | 'drift'`). Mirrors
   * the kernel's `BrainDecision.gateThatRefused` field — the SDK
   * keeps the wider `string` here so that future kernel additions
   * don't require an SDK rev to compile.
   */
  readonly gateThatRefused?: 'inviolable' | 'policy' | 'drift';
  readonly confidence?: {
    readonly groundedness: number;
    readonly stability: number;
    readonly review: number;
    readonly numericalConsistency: number;
    readonly overall: number;
  };
  readonly citations?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly confidence: number;
  }>;
  readonly provenance: {
    readonly thoughtId: string;
    readonly sensorId: string;
    readonly modelId: string;
    readonly latencyMs: number;
    readonly producedAt: string;
  };
}

export interface JarvisThinkResponse {
  readonly success: true;
  readonly surface: string;
  readonly persona: {
    readonly id: string;
    readonly displayName: string;
    readonly firstPersonNoun: string;
  };
  readonly decision: JarvisDecision;
}

export interface JarvisBriefingDataPoint {
  readonly topic: string;
  readonly summary: string;
  readonly severity: JarvisSeverity;
  readonly citationLabel?: string;
}

export interface JarvisBriefingRequest {
  readonly day: string;
  readonly threadId: string;
  readonly dataPoints: ReadonlyArray<JarvisBriefingDataPoint>;
}

export interface JarvisBriefing {
  readonly day: string;
  readonly headline: string;
  readonly bullets: ReadonlyArray<string>;
  readonly decision: JarvisDecision;
}

export interface JarvisProposeActionRequest {
  readonly thoughtId: string;
  readonly summary: string;
  readonly toolName: string;
  readonly payload?: Record<string, unknown>;
  readonly stakes?: 'medium' | 'high' | 'critical';
}

export interface JarvisApprovalSignature {
  readonly approverUserId: string;
  readonly verdict: 'approve' | 'reject';
  readonly comment: string | null;
  readonly signedAt: string;
}

export interface JarvisApprovalRecord {
  readonly action: {
    readonly id: string;
    readonly proposerUserId: string;
    readonly thoughtId: string;
    readonly summary: string;
    readonly toolName: string;
    /**
     * Opaque tool payload echoed back by the gateway. The kernel's
     * `ProposedAction.payload` is `Readonly<Record<string, unknown>>`;
     * we mirror that as a plain index signature so SDK consumers can
     * surface the action contents in approval-review UIs without a
     * cast. Schema validation happens on the executor side at run
     * time — the SDK does not narrow it.
     */
    readonly payload: Readonly<Record<string, unknown>>;
    readonly stakes: 'medium' | 'high' | 'critical';
    readonly proposedAt: string;
    readonly expiresAt: string;
  };
  readonly status: JarvisApprovalStatus;
  readonly signatures: ReadonlyArray<JarvisApprovalSignature>;
}

export interface JarvisSignRequest {
  readonly verdict: 'approve' | 'reject';
  readonly comment?: string;
}

/**
 * Briefing response — gateway returns the originating `surface` along
 * with the composed briefing so the client can verify (e.g. in dev
 * tools / audit logs) which Jarvis surface produced the result. The
 * SDK mirrors that 1:1 to avoid stripping fields a consumer may want
 * to display.
 */
export interface JarvisBriefingResponse {
  readonly success: true;
  readonly surface: string;
  readonly briefing: JarvisBriefing;
}

export interface JarvisSurfaceClient {
  readonly surface: JarvisSurface;
  think(req: JarvisThinkRequest): Promise<JarvisThinkResponse>;
  /**
   * Open an SSE stream for the same think request. Returns a handle
   * exposing an `AsyncIterable<JarvisStreamEvent>` of decoded events
   * plus an `abort()` method. The single-shot `think()` method is
   * preserved — streaming is additive.
   */
  stream(
    req: JarvisThinkRequest,
    options?: { signal?: AbortSignal; maxReconnect?: number },
  ): JarvisStreamHandle;
  briefing(req: JarvisBriefingRequest): Promise<JarvisBriefingResponse>;
  proposeAction(
    req: JarvisProposeActionRequest,
  ): Promise<{ success: true; approval: JarvisApprovalRecord }>;
  sign(
    actionId: string,
    req: JarvisSignRequest,
  ): Promise<{ success: true; approval: JarvisApprovalRecord }>;
  getAction(actionId: string): Promise<{ success: true; approval: JarvisApprovalRecord }>;
  listActions(filter?: {
    status?: JarvisApprovalStatus;
  }): Promise<{ success: true; approvals: ReadonlyArray<JarvisApprovalRecord> }>;
  /**
   * Record a feedback signal on a kernel turn. The gateway persists
   * one row in `kernel_feedback` (migration 0122) keyed by the
   * caller's tenantId + userId + this `thoughtId`. The kernel reads
   * the rolling window at step 4 (memory recall) on subsequent turns
   * so the brain learns from real interaction. Mirrors LITFIN's
   * online-learning loop and closes the "stock LLMs are STATIC"
   * assessment gap.
   */
  recordFeedback(
    req: JarvisRecordFeedbackRequest,
  ): Promise<{ success: true; id: string }>;
}

const SURFACE_PATH: Record<JarvisSurface, string> = {
  customer: '/api/v1/customer/jarvis',
  owner: '/api/v1/owner/jarvis',
  manager: '/api/v1/manager/jarvis',
  admin: '/api/v1/admin/jarvis',
  platform: '/api/v1/platform/jarvis',
};

/**
 * Build a typed Jarvis client for one surface. The underlying
 * transport is the shared BossnyumbaClient; we call its low-level
 * `request<T>` method (the Jarvis routes aren't yet codegen'd into
 * the OpenAPI `paths` shape so the typed helpers can't reach them).
 */
export function createJarvisClient(
  client: BossnyumbaClient,
  surface: JarvisSurface,
): JarvisSurfaceClient {
  const root = SURFACE_PATH[surface];

  return {
    surface,
    async think(req) {
      return client.request<JarvisThinkResponse>({
        method: 'POST',
        path: `${root}/think`,
        body: req,
      });
    },
    stream(req, options) {
      return createJarvisStream(client, surface, req, options ?? {});
    },
    async briefing(req) {
      return client.request<JarvisBriefingResponse>({
        method: 'POST',
        path: `${root}/briefing`,
        body: req,
      });
    },
    async proposeAction(req) {
      return client.request<{ success: true; approval: JarvisApprovalRecord }>({
        method: 'POST',
        path: `${root}/actions`,
        body: req,
      });
    },
    async sign(actionId, req) {
      return client.request<{ success: true; approval: JarvisApprovalRecord }>({
        method: 'POST',
        path: `${root}/actions/${encodeURIComponent(actionId)}/sign`,
        body: req,
      });
    },
    async getAction(actionId) {
      return client.request<{ success: true; approval: JarvisApprovalRecord }>({
        method: 'GET',
        path: `${root}/actions/${encodeURIComponent(actionId)}`,
      });
    },
    async listActions(filter) {
      const args: Parameters<BossnyumbaClient['request']>[0] = {
        method: 'GET',
        path: `${root}/actions`,
      };
      if (filter?.status) args.query = { status: filter.status };
      return client.request<{ success: true; approvals: ReadonlyArray<JarvisApprovalRecord> }>(args);
    },
    async recordFeedback(req) {
      return client.request<{ success: true; id: string }>({
        method: 'POST',
        path: `${root}/feedback`,
        body: req,
      });
    },
  };
}
