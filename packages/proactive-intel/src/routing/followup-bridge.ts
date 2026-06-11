/**
 * Follow-up bridge — the missing join the orchestration spec flags.
 *
 * Spec: "routed data with a deadline is never turned into a scheduled
 * follow-up candidate — add the doc-to-followup insert path so a routing
 * decision carrying a date emits a follow-up candidate (CoALA:
 * fact→semantic, event→episodic, how-to→procedural; a dated
 * obligation→FUTURE facet + follow-up scheduler)."
 *
 * This module is the PURE producer of that candidate. It deliberately
 * does NOT import `@borjie/user-followup` (keeps this package
 * dependency-free); it emits a structurally-compatible
 * `FollowupCandidateSeed` that the host maps onto the real
 * `FollowupCandidate` and inserts via the existing repository. The host
 * owns the id (uuid), the audit hash, and the persistence — this layer
 * only reasons about WHETHER and WITH-WHAT-PRIORITY.
 *
 * CONSTITUTIONAL: a gated decision still emits a follow-up — but as an
 * *approval* action, never an auto-action. The seed carries the decision's
 * gating forward so the host cannot accidentally auto-dispatch a gated
 * obligation.
 */
import type { DataRoutingDecision } from './routing-types.js';

/**
 * Channel hint — matches the existing user-followup channel vocabulary
 * ('inapp' | 'email' | 'whatsapp'). Chat-first by default per the
 * Sierra-style routing the proactive-intel barrel documents.
 */
export type FollowupChannelHint = 'inapp' | 'email' | 'whatsapp';

/**
 * Action hint — matches user-followup's `FollowupPayload.action.kind`
 * vocabulary so the host maps 1:1. A gated decision becomes 'approve';
 * an auto-eligible reminder becomes 'review'.
 */
export type FollowupActionHint = 'approve' | 'review' | 'walk_through' | 'dismiss';

/**
 * The structurally-compatible seed. Mirrors the host's
 * `FollowupCandidate` minus host-owned fields (id, audit_hash, the
 * concrete status lifecycle). The host fills those and validates with its
 * own zod schema before insert.
 */
export interface FollowupCandidateSeed {
  readonly tenantId: string | null;
  /** Source tag — maps to user-followup's 'anticipatory' source. */
  readonly source: 'anticipatory';
  readonly text: string;
  readonly priority: number; // [0,1]
  readonly channel: FollowupChannelHint;
  /** ISO-8601 — when the follow-up should surface (lead time applied). */
  readonly scheduledFor: string;
  readonly action: FollowupActionHint;
  readonly actionLabel: string;
  /**
   * TRUE on T-3-or-sooner dated obligations so the host can bypass the
   * daily cap (matches user-followup's `critical` bypass).
   */
  readonly critical: boolean;
  /** Evidence carried forward — the datum id + source field. */
  readonly evidence: ReadonlyArray<{ readonly title: string }>;
  /** Forwarded gating so the host never auto-dispatches a gated obligation. */
  readonly requiresHumanApproval: boolean;
}

/** Days before the due date the follow-up should first surface. */
const DEFAULT_LEAD_DAYS = 7;
/** A follow-up due within this many days bypasses the daily cap. */
const CRITICAL_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FollowupBridgeContext {
  readonly now: () => Date;
  /** Override the lead time (stakes-scaling). */
  readonly leadDays?: number;
  /** Override the default channel (chat-first 'inapp'). */
  readonly channel?: FollowupChannelHint;
}

/**
 * Turn a routing decision into a follow-up seed — or `null` when the
 * decision carries no dated obligation needing tracking.
 *
 * Emits a seed when `need` is 'follow-up' or 'reminder' AND an
 * `obligation` is present. 'workflow'/'nothing' decisions produce no
 * follow-up here (workflows are tracked by the workflow-engine; nothing
 * is file-and-forget).
 */
export function followupFromRouting(
  decision: DataRoutingDecision,
  ctx: FollowupBridgeContext,
): FollowupCandidateSeed | null {
  if (decision.need !== 'follow-up' && decision.need !== 'reminder') {
    return null;
  }
  const obligation = decision.obligation;
  if (!obligation) return null;

  const now = ctx.now();
  const leadDays = ctx.leadDays ?? DEFAULT_LEAD_DAYS;
  const dueMs = Date.parse(obligation.dueAt);
  if (Number.isNaN(dueMs)) return null;

  // Surface `leadDays` before the deadline, but never in the past.
  const surfaceMs = Math.max(dueMs - leadDays * DAY_MS, now.getTime());
  const critical = obligation.daysUntilDue <= CRITICAL_WINDOW_DAYS;

  // Priority: closer deadlines rank higher; overdue pegs to 1.
  const priority = priorityFor(obligation.daysUntilDue, leadDays);

  // A gated decision asks for approval; an auto-eligible one asks for review.
  const action: FollowupActionHint = decision.requiresHumanApproval
    ? 'approve'
    : 'review';

  return {
    tenantId: decision.tenantId,
    source: 'anticipatory',
    text: `${obligation.description}. ${decision.rationale.summary}`,
    priority,
    channel: ctx.channel ?? 'inapp',
    scheduledFor: new Date(surfaceMs).toISOString(),
    action,
    actionLabel: decision.requiresHumanApproval ? 'Review & approve' : 'Review',
    critical,
    evidence: [
      { title: `datum:${decision.datumId}` },
      { title: `field:${obligation.sourceFieldKey}` },
    ],
    requiresHumanApproval: decision.requiresHumanApproval,
  };
}

function priorityFor(daysUntilDue: number, leadDays: number): number {
  if (daysUntilDue <= 0) return 1; // overdue — top priority
  // Linear ramp from `leadDays`-out (low) to due-now (high), clamped.
  const span = Math.max(leadDays, 1);
  const ramp = 1 - daysUntilDue / span;
  return clamp01(Math.max(ramp, 0.5)); // dated obligations are never trivial
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
