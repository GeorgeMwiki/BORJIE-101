/**
 * MD Core - Subagent Contracts
 *
 * Typed interfaces the MD orchestrator uses to talk to the subagents
 * (next-best-action, auto-populate, owner-style, follow-up). Other agents
 * own the implementations; this file is the only seam between them.
 *
 * Each contract is intentionally narrow:
 *   - Inputs are read-only (immutability invariant).
 *   - Outputs are read-only.
 *   - No side-effect contracts here unless explicitly tagged (auto-populate +
 *     follow-up may persist; they are noted).
 *
 * @module features/central-command/md/core/contracts
 */

import type {
  BusinessSnapshot,
  RankedAction,
} from "@/features/central-command/md/nba/types";

// ---------------------------------------------------------------------------
// Re-export the canonical BusinessSnapshot from NBA so callers have a single
// import surface.
// ---------------------------------------------------------------------------

export type { BusinessSnapshot, RankedAction };

// ---------------------------------------------------------------------------
// Next-Best-Action subagent
// ---------------------------------------------------------------------------

export interface MdNbaPort {
  /**
   * Rank the top `k` actions for this business state. The MD orchestrator
   * uses this to render proposals.
   */
  rankActions(
    snapshot: BusinessSnapshot,
    k: number,
  ): Promise<ReadonlyArray<RankedAction>>;

  /**
   * Return one cheap, high-confidence move the owner can do today.
   */
  getNextLowHangingFruit(
    snapshot: BusinessSnapshot,
  ): Promise<RankedAction | null>;

  /**
   * Return the single highest-impact move regardless of effort.
   */
  getNextHighImpact(snapshot: BusinessSnapshot): Promise<RankedAction | null>;

  /**
   * Return a small daily agenda ordered by Eisenhower urgency.
   */
  getDailyAgenda(
    snapshot: BusinessSnapshot,
  ): Promise<ReadonlyArray<RankedAction>>;
}

// ---------------------------------------------------------------------------
// Auto-populate subagent
// ---------------------------------------------------------------------------

export interface MdAutoPopulateRequest {
  readonly orgId: string;
  /** Free text from the owner that drove the request. */
  readonly hint: string;
  /** Target form id or entity kind to populate. */
  readonly target: string;
  /** Tier of the caller; routes the data fetch. */
  readonly tier: string;
}

export interface MdAutoPopulateResult {
  readonly ok: boolean;
  readonly target: string;
  /** Field -> value pairs the subagent inferred from existing business data. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Provenance per field: which snapshot path produced it. */
  readonly provenance: Readonly<Record<string, string>>;
  /** Fields the subagent could not populate; owner must fill manually. */
  readonly gaps: ReadonlyArray<string>;
}

export interface MdAutoPopulatePort {
  /**
   * Populate a target form / entity using business state. Side-effecting
   * persistence is the caller's choice; this contract returns a plan.
   */
  populate(req: MdAutoPopulateRequest): Promise<MdAutoPopulateResult>;
}

// ---------------------------------------------------------------------------
// Owner-style subagent
// ---------------------------------------------------------------------------

export interface MdOwnerStyleProfile {
  readonly ownerId: string;
  readonly posture:
    | "bias-to-action"
    | "deliberate"
    | "data-driven"
    | "people-first";
  /** 0..1 confidence. */
  readonly confidence: number;
  /** Words / cadence preferences captured over time. */
  readonly tonePrefs: ReadonlyArray<string>;
  /** Last refinement timestamp. */
  readonly updatedAtMs: number;
}

export interface MdOwnerStyleObservation {
  readonly text: string;
  readonly tsMs: number;
}

export interface MdOwnerStylePort {
  /** Return the most recent style profile for `ownerId`. */
  getProfile(ownerId: string): Promise<MdOwnerStyleProfile | null>;

  /**
   * Refine the style profile with new observations from this turn.
   * Returns the updated profile and a short note explaining what shifted.
   */
  refine(
    ownerId: string,
    observations: ReadonlyArray<MdOwnerStyleObservation>,
  ): Promise<{
    readonly profile: MdOwnerStyleProfile;
    readonly changeNote: string;
  }>;
}

// ---------------------------------------------------------------------------
// Follow-up subagent
// ---------------------------------------------------------------------------

export interface MdFollowUpRequest {
  readonly orgId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly dueAtMs: number;
  readonly sourceRef?: string;
  readonly subjectKind?: string;
  readonly subjectId?: string;
}

export interface MdFollowUpRecord {
  readonly followUpId: string;
  readonly orgId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly dueAtMs: number;
  readonly sourceRef?: string;
  readonly subjectKind?: string;
  readonly subjectId?: string;
  readonly createdAtMs: number;
}

export interface MdFollowUpPort {
  /** Persist a follow-up so the timeline / heartbeat can resurface it. */
  schedule(req: MdFollowUpRequest): Promise<MdFollowUpRecord>;

  /** List the follow-ups due before `beforeMs`. */
  listDue(
    orgId: string,
    beforeMs: number,
  ): Promise<ReadonlyArray<MdFollowUpRecord>>;
}

// ---------------------------------------------------------------------------
// MD Timeline port — owner asks "what's the plan?", orchestrator builds a
// CPM-aware milestone list out of the ranked actions.
// ---------------------------------------------------------------------------

export interface MdTimelineRequest {
  readonly orgId: string;
  readonly actions: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly effortPersonDays: number;
    readonly dependsOn?: ReadonlyArray<string>;
  }>;
  readonly startMs: number;
}

export interface MdTimelineMilestone {
  readonly id: string;
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly slackDays: number;
  readonly onCriticalPath: boolean;
}

export interface MdTimelinePort {
  /**
   * Convert a set of ranked actions into a CPM-aware milestone list.
   * The adapter may degrade to a simple sequential schedule when the
   * underlying generator is unavailable.
   */
  build(req: MdTimelineRequest): Promise<ReadonlyArray<MdTimelineMilestone>>;
}

// ---------------------------------------------------------------------------
// MD Employees port — sentiment aggregate per employee so observations
// can flag "Aisha's last 1-on-1 was 47 days ago" / "engineering NPS down".
// ---------------------------------------------------------------------------

export interface MdEmployeeSignal {
  readonly employeeId: string;
  readonly name: string;
  readonly recentSentiment: "positive" | "neutral" | "negative" | "mixed";
  readonly daysSinceLastOneOnOne: number;
  readonly riskScore: number;
}

export interface MdEmployeesPort {
  /**
   * Read the active-employee sentiment aggregate for an org. Returns
   * an empty array when the subagent is unconfigured or every reader
   * times out.
   */
  read(orgId: string): Promise<ReadonlyArray<MdEmployeeSignal>>;
}

// ---------------------------------------------------------------------------
// MD Presenter port — turn the owner's text into an inline gen-UI spec
// when the message is a data-request ("show me cash trend",
// "open the lead pipeline").
// ---------------------------------------------------------------------------

export interface MdPresenterRequest {
  readonly text: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly tier:
    | "borrower"
    | "officer"
    | "org-admin"
    | "borjie-admin"
    | "sovereign";
  readonly correlationId: string;
  readonly sessionId: string;
}

export interface MdPresenterResult {
  /** Stable trace id from the presenter's own decision-trace. */
  readonly traceId: string;
  /**
   * The serialisable generative-UI spec (chart / table / file-preview).
   * The orchestrator forwards this to the chat surface as an inline
   * payload on the assistant_text envelope.
   */
  readonly spec: Readonly<Record<string, unknown>>;
  readonly subject: string;
  readonly kind: string;
}

export interface MdPresenterPort {
  /**
   * Try to render an inline-data response. Returns `null` when the
   * text is not a data-request OR the underlying data store has
   * nothing relevant — the caller falls back to the normal MD turn.
   */
  process(req: MdPresenterRequest): Promise<MdPresenterResult | null>;
}

// ---------------------------------------------------------------------------
// Aggregate subagent bundle the orchestrator receives via dependency injection
// ---------------------------------------------------------------------------

export interface MdSubagents {
  readonly nba: MdNbaPort;
  readonly autoPopulate: MdAutoPopulatePort;
  readonly ownerStyle: MdOwnerStylePort;
  readonly followUp: MdFollowUpPort;
  readonly timeline: MdTimelinePort;
  readonly employees: MdEmployeesPort;
  readonly presenter: MdPresenterPort;
}
