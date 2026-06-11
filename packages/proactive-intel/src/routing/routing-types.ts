/**
 * Data-routing reasoner — type surface.
 *
 * "The whole thinking behind it": given a captured document/datum (from
 * the ingest path), decide WHERE it belongs (which tab/record/entity),
 * WHY, and whether it needs a reminder / follow-up / workflow / nothing.
 *
 * This is ADDITIVE. It never replaces `@borjie/document-analysis`'s
 * `decideRouting`/`ROUTING_MATRIX` (the structural where-to-file rules)
 * nor the dispatch-router. It sits ABOVE them as the reasoning layer
 * that turns a routed datum into a structured *decision object* the
 * proactive-triggers + tab-spawn paths can consume — emitting the
 * follow-up / reminder / workflow needs that the matrix alone cannot.
 *
 * Pure contracts only — no I/O, no runtime. All scoring is deterministic.
 *
 * CONSTITUTIONAL: every decision composes-with the kernel rails. When a
 * rail says GATE (sovereign / money / four_eye / kill_switch /
 * policy_rollout), the decision is gated REGARDLESS of any autonomy
 * computation here. This layer may only ADD gating, never remove it —
 * see `rail-gate.ts`.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Captured datum (the ingest input we reason over)
// ---------------------------------------------------------------------------

/**
 * The unit this reasoner routes. Deliberately decoupled from
 * document-analysis's internal `DocType` so this package stays
 * dependency-free; the host maps a `RoutingDecision`/`ConversationCapture`
 * onto this shape before calling. `kind` is a free-form domain tag
 * ('payment_receipt', 'licence_renewal', 'assay_report', ...).
 */
export interface CapturedDatum {
  /** Stable id of the captured artifact (document id, message id, ...). */
  readonly id: string;
  readonly tenantId: string | null;
  /** Free-form domain kind. Lower-cased snake by convention. */
  readonly kind: string;
  /**
   * Confidence the upstream classifier had in `kind` ∈ [0,1]. Drives the
   * HITL threshold here exactly as it does in the document-analysis route
   * layer.
   */
  readonly classificationConfidence: number;
  /** Already-extracted structured fields, keyed by canonical name. */
  readonly fields: Readonly<Record<string, ExtractedDatumField>>;
  /** ISO-8601 capture time. */
  readonly capturedAt: string;
  /** Optional free-form provenance ('document', 'chat', 'email', ...). */
  readonly origin?: string;
}

export interface ExtractedDatumField {
  readonly value: unknown;
  /** Per-field extraction confidence ∈ [0,1]. */
  readonly confidence: number;
  /** Optional ISO-8601 if the field IS a date (deadline detection). */
  readonly isoDate?: string;
}

// ---------------------------------------------------------------------------
// Routing destination + needs
// ---------------------------------------------------------------------------

/**
 * WHERE the datum belongs. Mirrors the platform module taxonomy used by
 * the document-analysis route layer + dispatch-router, kept loose so the
 * host can extend without a code edit here.
 */
export type RoutingModule =
  | 'finance'
  | 'compliance'
  | 'legal'
  | 'estate'
  | 'crm'
  | 'workforce'
  | 'marketplace'
  | 'treasury'
  | 'unknown'
  | (string & {});

/** What the brain should DO with the routed datum, beyond filing it. */
export type RoutingNeed =
  | 'nothing' // file-and-forget
  | 'reminder' // a dated nudge (no multi-step flow)
  | 'follow-up' // a tracked follow-up candidate (user-followup)
  | 'workflow'; // kick a known deterministic multi-step flow

/**
 * Why the decision routed where it did + needs what it needs. Every
 * field is evidence the Auditor can inspect; satisfies the
 * evidence-required rule (≥1 evidence pointer).
 */
export interface RoutingRationale {
  /** One-line owner-facing explanation. */
  readonly summary: string;
  /** Machine rationale tag (stable, testable). */
  readonly code: RoutingRationaleCode;
  /** Concrete evidence pointers (field keys / record ids) — never empty. */
  readonly evidence: ReadonlyArray<RoutingEvidence>;
  /** The combined confidence the destination is correct ∈ [0,1]. */
  readonly destinationConfidence: number;
}

export type RoutingRationaleCode =
  | 'high_confidence_match'
  | 'low_confidence_match'
  | 'required_field_missing'
  | 'no_kind_match'
  | 'dated_obligation'
  | 'rail_gated';

export interface RoutingEvidence {
  /** What the pointer references ('field' | 'classification' | 'rule'). */
  readonly kind: 'field' | 'classification' | 'rule' | 'datum';
  /** Stable id of the referenced thing (field key, datum id, rule code). */
  readonly id: string;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * The structured routing decision. ADDITIVE output consumed by the
 * proactive-triggers + tab-spawn paths.
 *
 * `requiresHumanApproval` is the gate. It is the LOGICAL-OR of:
 *   - low combined confidence (HITL threshold, mirrors doc-analysis),
 *   - a missing required field,
 *   - a rail GATE verdict (always wins — see rail-gate.ts).
 *
 * `autonomyEligible` is the inverse SUBJECT-TO rails: it can only be true
 * when NO rail gates AND confidence clears the bar. A rail GATE forces it
 * false irrevocably.
 */
export interface DataRoutingDecision {
  readonly datumId: string;
  readonly tenantId: string | null;
  /** WHERE. */
  readonly targetModule: RoutingModule;
  /** The specific record/action target within the module. */
  readonly targetAction: string;
  /** WHY. */
  readonly rationale: RoutingRationale;
  /** WHAT-NEXT. */
  readonly need: RoutingNeed;
  /** GATE — true if a human must confirm before any side-effect. */
  readonly requiresHumanApproval: boolean;
  /** Whether this MAY be auto-handled (false whenever a rail gates). */
  readonly autonomyEligible: boolean;
  /**
   * If `need` is 'reminder' | 'follow-up', the dated obligation that
   * triggered it — the join the proactive worker turns into a scheduled
   * candidate. `null` for 'nothing'/'workflow'.
   */
  readonly obligation: DatedObligation | null;
  /** If `need` is 'workflow', the workflow target to identify. */
  readonly workflowHint: string | null;
  readonly decidedAt: string;
}

/**
 * A dated obligation extracted from the datum — the CoALA event→FUTURE
 * facet seed and the doc→follow-up join. Pure data; the host inserts it
 * into the existing follow-up scheduler (see followup-bridge.ts).
 */
export interface DatedObligation {
  /** ISO-8601 deadline. */
  readonly dueAt: string;
  /** Which field carried the date (evidence). */
  readonly sourceFieldKey: string;
  /** Owner-facing description of what is due. */
  readonly description: string;
  /** Days from `decidedAt` to `dueAt` (negative = already past). */
  readonly daysUntilDue: number;
}

// ---------------------------------------------------------------------------
// Zod schemas (host-boundary runtime validation)
// ---------------------------------------------------------------------------

export const extractedDatumFieldSchema = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  isoDate: z.string().optional(),
});

export const capturedDatumSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1).nullable(),
  kind: z.string().min(1),
  classificationConfidence: z.number().min(0).max(1),
  fields: z.record(z.string(), extractedDatumFieldSchema),
  capturedAt: z.string().min(1),
  origin: z.string().optional(),
});

export type CapturedDatumInput = z.infer<typeof capturedDatumSchema>;
