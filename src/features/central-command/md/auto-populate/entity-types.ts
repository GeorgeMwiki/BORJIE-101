/**
 * Auto-Populate — Entity Type Definitions
 *
 * Discriminated-union Zod schemas for every business entity the
 * Managing Director's auto-populate engine can silently extract from
 * casual owner chat.
 *
 * Design notes:
 *   - Tagged by `kind` so callers can switch on a single field.
 *   - Every entity has `canonicalName` (lowercased, punctuation-stripped)
 *     for dedupe / idempotency on (tenant_id, canonical_name).
 *   - Every entity has `sourceSpan` so the audit trail can quote the
 *     exact substring of the chat turn that triggered the extraction.
 *   - All fields are immutable in the inferred TS types (z.readonly is
 *     applied at the field level via .readonly() where applicable, and
 *     the consumer treats objects as read-only by convention).
 *   - Optional fields use `.optional()` rather than `| undefined` so the
 *     LLM extractor can simply omit them when uncertain.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared scalars
// ---------------------------------------------------------------------------

/** ISO-8601 date or datetime string (we don't enforce the exact shape — the
 *  LLM may emit "2026-05-17", "2026-05-17T14:30:00Z", or natural language we
 *  re-parse downstream). Empty string is rejected. */
export const isoDateLike = z.string().min(1).max(64);

/** A confidence score 0..1 emitted by the extractor for each entity. */
export const confidence = z.number().min(0).max(1);

/** Source-span: which substring of the chat turn produced the entity.
 *  Used by the audit-trail UI to highlight evidence. */
export const sourceSpan = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  text: z.string().min(1).max(800),
});

export type SourceSpan = z.infer<typeof sourceSpan>;

// ---------------------------------------------------------------------------
// Canonical-name normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a name for idempotent (tenant_id, canonical_name) keys.
 * Lower-cases, strips punctuation, collapses whitespace, removes common
 * corporate suffixes ("inc", "ltd", "llc", "corp", "corporation",
 * "limited", "plc", "co"). Does NOT translate — only canonicalises.
 *
 * Pure function; safe to call client- and server-side.
 */
export function canonicaliseName(raw: string): string {
  const stripped = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stripped.split(" ").filter(Boolean);
  const corporateSuffixes = new Set([
    "inc",
    "incorporated",
    "ltd",
    "limited",
    "llc",
    "corp",
    "corporation",
    "plc",
    "co",
    "company",
    "group",
    "holdings",
  ]);
  const trimmed = [...tokens];
  while (trimmed.length > 1) {
    const last = trimmed[trimmed.length - 1];
    if (last && corporateSuffixes.has(last)) {
      trimmed.pop();
    } else {
      break;
    }
  }
  return trimmed.join(" ");
}

// ---------------------------------------------------------------------------
// Base fields every entity shares
// ---------------------------------------------------------------------------

const baseEntity = {
  /** Lower-cased de-punctuated name used for idempotency. Auto-derived from
   *  the human-facing name when the extractor omits it. */
  canonicalName: z.string().min(1).max(240),
  /** Original human-facing name as the owner phrased it. */
  displayName: z.string().min(1).max(240),
  /** Extractor confidence 0..1. */
  confidence,
  /** Substring of the chat turn that produced this entity. */
  sourceSpan,
  /** Optional free-form note carried straight from the chat. */
  notes: z.string().max(2000).optional(),
};

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export const employeeSchema = z
  .object({
    kind: z.literal("employee"),
    ...baseEntity,
    role: z.string().max(120).optional(),
    department: z.string().max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
    startDate: isoDateLike.optional(),
    isNewHire: z.boolean().optional(),
  })
  .strict();

export type Employee = z.infer<typeof employeeSchema>;

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export const customerSchema = z
  .object({
    kind: z.literal("customer"),
    ...baseEntity,
    industry: z.string().max(120).optional(),
    contactName: z.string().max(120).optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().max(40).optional(),
    arrUsd: z.number().nonnegative().optional(),
    signedDate: isoDateLike.optional(),
    status: z.enum(["prospect", "active", "churned", "paused"]).optional(),
  })
  .strict();

export type Customer = z.infer<typeof customerSchema>;

// ---------------------------------------------------------------------------
// Product / SKU
// ---------------------------------------------------------------------------

export const productSchema = z
  .object({
    kind: z.literal("product"),
    ...baseEntity,
    sku: z.string().max(80).optional(),
    category: z.string().max(120).optional(),
    priceUsd: z.number().nonnegative().optional(),
    isTopSeller: z.boolean().optional(),
    margin: z.number().min(-1).max(1).optional(),
  })
  .strict();

export type Product = z.infer<typeof productSchema>;

// ---------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------

export const supplierSchema = z
  .object({
    kind: z.literal("supplier"),
    ...baseEntity,
    category: z.string().max(120).optional(),
    contactName: z.string().max(120).optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().max(40).optional(),
    annualSpendUsd: z.number().nonnegative().optional(),
    criticality: z.enum(["low", "medium", "high"]).optional(),
    contractRenewalDate: isoDateLike.optional(),
  })
  .strict();

export type Supplier = z.infer<typeof supplierSchema>;

// ---------------------------------------------------------------------------
// Meeting
// ---------------------------------------------------------------------------

export const meetingSchema = z
  .object({
    kind: z.literal("meeting"),
    ...baseEntity,
    occurredAt: isoDateLike.optional(),
    attendees: z.array(z.string().min(1).max(120)).max(40).optional(),
    topic: z.string().max(240).optional(),
    outcome: z.string().max(2000).optional(),
  })
  .strict();

export type Meeting = z.infer<typeof meetingSchema>;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export const decisionSchema = z
  .object({
    kind: z.literal("decision"),
    ...baseEntity,
    decidedAt: isoDateLike.optional(),
    rationale: z.string().max(2000).optional(),
    impactArea: z.string().max(120).optional(),
    reversible: z.boolean().optional(),
  })
  .strict();

export type Decision = z.infer<typeof decisionSchema>;

// ---------------------------------------------------------------------------
// Feedback (from customer / employee / partner)
// ---------------------------------------------------------------------------

export const feedbackSchema = z
  .object({
    kind: z.literal("feedback"),
    ...baseEntity,
    source: z.string().max(120).optional(),
    sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
    topic: z.string().max(240).optional(),
  })
  .strict();

export type Feedback = z.infer<typeof feedbackSchema>;

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

export const goalSchema = z
  .object({
    kind: z.literal("goal"),
    ...baseEntity,
    targetDate: isoDateLike.optional(),
    metric: z.string().max(120).optional(),
    targetValue: z.number().optional(),
    owner: z.string().max(120).optional(),
  })
  .strict();

export type Goal = z.infer<typeof goalSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const projectSchema = z
  .object({
    kind: z.literal("project"),
    ...baseEntity,
    status: z
      .enum(["proposed", "active", "blocked", "shipped", "cancelled"])
      .optional(),
    startedAt: isoDateLike.optional(),
    dueDate: isoDateLike.optional(),
    owner: z.string().max(120).optional(),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export const riskSchema = z
  .object({
    kind: z.literal("risk"),
    ...baseEntity,
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    likelihood: z
      .enum(["unlikely", "possible", "likely", "certain"])
      .optional(),
    mitigation: z.string().max(2000).optional(),
  })
  .strict();

export type Risk = z.infer<typeof riskSchema>;

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

export const opportunitySchema = z
  .object({
    kind: z.literal("opportunity"),
    ...baseEntity,
    estimatedValueUsd: z.number().nonnegative().optional(),
    probability: z.number().min(0).max(1).optional(),
    horizon: z
      .enum(["now", "this-quarter", "this-year", "long-term"])
      .optional(),
  })
  .strict();

export type Opportunity = z.infer<typeof opportunitySchema>;

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const extractedEntitySchema = z.discriminatedUnion("kind", [
  employeeSchema,
  customerSchema,
  productSchema,
  supplierSchema,
  meetingSchema,
  decisionSchema,
  feedbackSchema,
  goalSchema,
  projectSchema,
  riskSchema,
  opportunitySchema,
]);

export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;

export type EntityKind = ExtractedEntity["kind"];

/** All entity kinds the auto-populate engine knows about. */
export const ALL_ENTITY_KINDS: ReadonlyArray<EntityKind> = [
  "employee",
  "customer",
  "product",
  "supplier",
  "meeting",
  "decision",
  "feedback",
  "goal",
  "project",
  "risk",
  "opportunity",
] as const;

/**
 * The DB table name we persist each kind to. Keep this in sync with
 * `migration.sql` — both sides reference the same canonical names.
 */
export const ENTITY_KIND_TO_TABLE: Readonly<Record<EntityKind, string>> = {
  employee: "ap_employees",
  customer: "ap_customers",
  product: "ap_products",
  supplier: "ap_suppliers",
  meeting: "ap_meetings",
  decision: "ap_decisions",
  feedback: "ap_feedback",
  goal: "ap_goals",
  project: "ap_projects",
  risk: "ap_risks",
  opportunity: "ap_opportunities",
} as const;

/** Default confidence threshold for auto-persist (no owner confirmation). */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7 as const;
