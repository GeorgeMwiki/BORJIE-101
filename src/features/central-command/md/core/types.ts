/**
 * MD Core - Event Types
 *
 * The MD ("Managing Director") agent emits a typed stream of events while
 * orchestrating a conversation with a business owner. Every event is
 * Zod-validated so external producers (subagents, route handlers) cannot
 * inject malformed payloads into the command-chat SSE protocol.
 *
 * Event taxonomy (discriminated union on `kind`):
 *   md.observation   - the MD noticed something in the business state.
 *                       inert by construction (no side effects).
 *   md.assessment    - the MD evaluated a signal against a framework
 *                       (ICE / RICE / Eisenhower / OKR / Hoshin Kanri).
 *   md.proposal      - the MD recommends a specific action; carries an
 *                       autonomy level so the chat surface can render the
 *                       right affordance (suggest / recommend / approval).
 *   md.action        - the MD is acting (act-with-approval or
 *                       act-autonomous). A DecisionTrace id MUST be
 *                       attached.
 *   md.follow-up     - the MD scheduled a follow-up against a subject.
 *   md.style-update  - owner-style profile was refined this turn.
 *
 * All shapes are deep-readonly to honour the immutability invariant.
 *
 * @module features/central-command/md/core/types
 */

import { z } from "zod";

import type { AutonomyLevel } from "@/core/brain/autonomy/levels";
import type { BorjieAITier } from "@/core/governance/tier-policy";

// ---------------------------------------------------------------------------
// Framework tags + severity
// ---------------------------------------------------------------------------

export const MD_FRAMEWORK_TAGS = [
  "ICE",
  "RICE",
  "WSJF",
  "EISENHOWER",
  "OKR",
  "HOSHIN_KANRI",
  "FIVE_WHYS",
  "PORTERS_FIVE_FORCES",
  "NONE",
] as const;

export const MdFrameworkSchema = z.enum(MD_FRAMEWORK_TAGS);
export type MdFramework = z.infer<typeof MdFrameworkSchema>;

export const MD_SEVERITIES = ["info", "watch", "concern", "urgent"] as const;
export const MdSeveritySchema = z.enum(MD_SEVERITIES);
export type MdSeverity = z.infer<typeof MdSeveritySchema>;

export const MD_AUTONOMY_LEVELS = [
  "suggest",
  "recommend",
  "act-with-approval",
  "act-autonomous",
] as const;
export const MdAutonomyLevelSchema = z.enum(MD_AUTONOMY_LEVELS);
// Re-export the canonical AutonomyLevel; we ensure the local enum matches.
export type MdAutonomyLevel = AutonomyLevel;

// ---------------------------------------------------------------------------
// Common payload pieces
// ---------------------------------------------------------------------------

export const MdSubjectRefSchema = z.object({
  kind: z.enum([
    "customer",
    "employee",
    "lead",
    "supplier",
    "invoice",
    "kpi",
    "obligation",
    "product",
    "task",
    "deal",
    "other",
  ]),
  id: z.string().min(1),
  label: z.string().optional(),
});

export type MdSubjectRef = z.infer<typeof MdSubjectRefSchema>;

export const MdCitationSchema = z.object({
  /** stable id of the snapshot field cited (e.g. "finance.cashUsd"). */
  field: z.string().min(1),
  /** human-readable value snapshot for replayability. */
  valueSummary: z.string().min(1),
});

export type MdCitation = z.infer<typeof MdCitationSchema>;

// ---------------------------------------------------------------------------
// md.observation
// ---------------------------------------------------------------------------

export const MdObservationSchema = z.object({
  kind: z.literal("md.observation"),
  eventId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  severity: MdSeveritySchema,
  summary: z.string().min(1).max(500),
  /** Snapshot fields that justify the observation. */
  citations: z.array(MdCitationSchema).readonly(),
  subjectRef: MdSubjectRefSchema.optional(),
});

export type MdObservation = z.infer<typeof MdObservationSchema>;

// ---------------------------------------------------------------------------
// md.assessment
// ---------------------------------------------------------------------------

export const MdAssessmentSchema = z.object({
  kind: z.literal("md.assessment"),
  eventId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  framework: MdFrameworkSchema,
  summary: z.string().min(1).max(800),
  /** Score the framework produced, when applicable. 0..100. */
  score: z.number().min(0).max(100).optional(),
  citations: z.array(MdCitationSchema).readonly(),
  subjectRef: MdSubjectRefSchema.optional(),
});

export type MdAssessment = z.infer<typeof MdAssessmentSchema>;

// ---------------------------------------------------------------------------
// md.proposal
// ---------------------------------------------------------------------------

export const MdProposalSchema = z.object({
  kind: z.literal("md.proposal"),
  eventId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  /** Stable id of the proposed action; used for follow-up + approval keys. */
  proposalId: z.string().min(1),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1).max(2000),
  /** What rung the MD is asking for on this turn. */
  autonomyLevel: MdAutonomyLevelSchema,
  /** Whether four-eye approval is required to escalate to side-effect. */
  requiresApproval: z.boolean(),
  /** Composite priority score (e.g. ICE * confidence). */
  priorityScore: z.number().min(0).max(1000),
  framework: MdFrameworkSchema,
  citations: z.array(MdCitationSchema).readonly(),
  subjectRef: MdSubjectRefSchema.optional(),
});

export type MdProposal = z.infer<typeof MdProposalSchema>;

// ---------------------------------------------------------------------------
// md.action
// ---------------------------------------------------------------------------

export const MdActionSchema = z.object({
  kind: z.literal("md.action"),
  eventId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  /** Stable id of the executed action. */
  actionId: z.string().min(1),
  /** Linked DecisionTrace id; every action MUST be replayable. */
  traceId: z.string().min(1),
  autonomyLevel: MdAutonomyLevelSchema,
  /** approvalId is required for act-with-approval; null when autonomous. */
  approvalId: z.string().nullable(),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(800),
  status: z.enum(["queued", "running", "settled", "rolled-back", "failed"]),
  subjectRef: MdSubjectRefSchema.optional(),
});

export type MdAction = z.infer<typeof MdActionSchema>;

// ---------------------------------------------------------------------------
// md.follow-up
// ---------------------------------------------------------------------------

export const MdFollowUpSchema = z.object({
  kind: z.literal("md.follow-up"),
  eventId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  followUpId: z.string().min(1),
  title: z.string().min(1).max(200),
  /** When the MD should resurface this. */
  dueAtMs: z.number().int().nonnegative(),
  /** Originating proposal/action id, when linked. */
  sourceRef: z.string().min(1).optional(),
  subjectRef: MdSubjectRefSchema.optional(),
});

export type MdFollowUp = z.infer<typeof MdFollowUpSchema>;

// ---------------------------------------------------------------------------
// md.style-update
// ---------------------------------------------------------------------------

export const MdStyleUpdateSchema = z.object({
  kind: z.literal("md.style-update"),
  eventId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  /** Free-form note about what shifted in the owner-style profile. */
  note: z.string().min(1).max(400),
  /** Tag set summarising the new preferred posture. */
  posture: z.enum([
    "bias-to-action",
    "deliberate",
    "data-driven",
    "people-first",
  ]),
  /** A confidence in the update, 0..1. */
  confidence: z.number().min(0).max(1),
});

export type MdStyleUpdate = z.infer<typeof MdStyleUpdateSchema>;

// ---------------------------------------------------------------------------
// md.assistant_text
//
// UI-only convenience envelope emitted by the SSE route after the typed
// MdEvent stream so the chat shell can render a composed natural-language
// reply alongside the structured events. The orchestrator itself does not
// emit this kind; it is synthesised at the edge.
// ---------------------------------------------------------------------------

export const MdAssistantTextSchema = z.object({
  kind: z.literal("md.assistant_text"),
  /** Composed natural-language reply for the chat surface. */
  text: z.string().min(1),
  /** DecisionTrace id linking this turn's reasoning, when available. */
  traceId: z.string().min(1).optional(),
});

export type MdAssistantText = z.infer<typeof MdAssistantTextSchema>;

// ---------------------------------------------------------------------------
// md.error
//
// Emitted by the SSE route when the orchestrator throws. The chat
// shell renders this as an alert card so the owner sees a clear
// failure signal instead of an empty stream. H-2 fix: the route was
// already emitting `{kind: "md.error", message}` but the discriminated
// union rejected it, so `parseMdEvent` dropped the frame and
// `MDEventRenderer`'s default branch returned null.
// ---------------------------------------------------------------------------

export const MdErrorSchema = z.object({
  kind: z.literal("md.error"),
  /** Human-readable summary safe to render directly. */
  message: z.string().min(1).max(2000),
});

export type MdError = z.infer<typeof MdErrorSchema>;

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const MdEventSchema = z.discriminatedUnion("kind", [
  MdObservationSchema,
  MdAssessmentSchema,
  MdProposalSchema,
  MdActionSchema,
  MdFollowUpSchema,
  MdStyleUpdateSchema,
  MdAssistantTextSchema,
  MdErrorSchema,
]);

export type MdEvent = z.infer<typeof MdEventSchema>;

export const MD_EVENT_KINDS = [
  "md.observation",
  "md.assessment",
  "md.proposal",
  "md.action",
  "md.follow-up",
  "md.style-update",
  "md.assistant_text",
  "md.error",
] as const;

export type MdEventKind = (typeof MD_EVENT_KINDS)[number];

// ---------------------------------------------------------------------------
// Orchestrator turn IO
// ---------------------------------------------------------------------------

/**
 * iter-39: jurisdiction context carried per-turn into the system
 * prompt. Resolved by the chat route from the org's primary
 * jurisdiction assignment; passed through to the brain so every
 * chat reply cites the correct local regulator + currency + APR
 * cap. Mirrors `MdSystemPromptJurisdiction` deliberately so the
 * schemas don't drift; a small structural test asserts the shape.
 */
export const MdTurnInputJurisdictionSchema = z.object({
  code: z.string().min(1).max(8),
  name: z.string().min(1).max(80),
  currency: z.string().min(1).max(8),
  aprCap: z.number().nullable(),
  regulators: z.array(z.string().min(1).max(40)).optional(),
});

export type MdTurnInputJurisdiction = z.infer<
  typeof MdTurnInputJurisdictionSchema
>;

export const MdTurnInputSchema = z.object({
  orgId: z.string().min(1),
  ownerId: z.string().min(1),
  sessionId: z.string().min(1),
  correlationId: z.string().min(1),
  /** Tier of the caller; routes memory + governance. */
  tier: z.custom<BorjieAITier>(
    (val) =>
      typeof val === "string" &&
      [
        "borrower",
        "officer",
        "org-admin",
        "borjie-admin",
        "sovereign",
      ].includes(val),
    { message: "invalid BorjieAITier" },
  ),
  /** The owner's chat message; cleansed and length-bounded upstream. */
  text: z.string().min(1).max(4000),
  /** Portal id that originated the chat (passed through to traces). */
  portalId: z.string().min(1),
  /** Route handler id, for traces. */
  route: z.string().min(1),
  /** iter-39: optional jurisdiction context for system-prompt
   *  rendering. Resolved by the chat route ahead of runTurn. */
  jurisdiction: MdTurnInputJurisdictionSchema.optional(),
});

export type MdTurnInput = z.infer<typeof MdTurnInputSchema>;

export interface MdTurnResult {
  readonly traceId: string;
  readonly events: ReadonlyArray<MdEvent>;
  readonly assistantText: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isMdEventKind(value: string): value is MdEventKind {
  return (MD_EVENT_KINDS as ReadonlyArray<string>).includes(value);
}

export function parseMdEvent(raw: unknown): MdEvent {
  return MdEventSchema.parse(raw);
}
