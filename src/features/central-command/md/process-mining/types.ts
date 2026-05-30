/**
 * Process-mining shared types.
 *
 * Pipeline shape (every stage is HITL-gated):
 *
 *   Observer junior  →  process_events (append-only)
 *                          ↓
 *   Mapper junior    →  process_maps (versioned, immutable)
 *                          ↓                       [owner reviews map]
 *   Diagnoser junior →  Bottleneck[] + RewordLoop[]
 *                          ↓                       [owner picks targets]
 *   Researcher junior →  Citation[] (web research)
 *                          ↓
 *   Redesigner junior →  process_redesigns (pending → approved)
 *                          ↓                       [4-eye gate #1]
 *   Automator junior →  automation_manifests (status=draft)
 *                          ↓                       [4-eye gate #2 to activate]
 *   Verifier junior  →  process_canary_runs (conformance)
 *                          ↓                       [owner flips ACTIVE]
 *   automation runs live, every step still passes assertTierPolicy
 *
 * @module features/central-command/md/process-mining/types
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Process-event log
// ---------------------------------------------------------------------------

export const ACTOR_KINDS = ["user", "junior", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

// C-1 / L-3 hardening: block all ASCII control characters (U+0000–
// U+001F + U+007F) from any field that ever participates in a graph
// edge key. The miner uses U+0000 (NUL) as its edge-key separator;
// since NUL is in the blocked range, no caller can craft an
// `activity = "A<NUL>evil"` payload that would forge a fake edge.
//
// Explicit \u escapes used here so the source is robust against
// editors / lint pipelines that silently strip non-printable bytes.
const EDGE_KEY_SAFE_RE = /^[^\u0000-\u001f\u007f]+$/u;

// H-2 hardening: bar prototype-pollution attribute keys. Even though
// the values land in JSONB (no merge), the read path types them as
// Record<string, unknown> which Object.assign-style consumers could
// later spread. Cheap defence at the input gate.
const SAFE_ATTRIBUTE_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const FORBIDDEN_ATTR_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const attributesSchema = z
  .record(z.string(), z.unknown())
  .superRefine((rec, ctx) => {
    for (const k of Object.keys(rec)) {
      if (FORBIDDEN_ATTR_KEYS.has(k) || !SAFE_ATTRIBUTE_KEY_RE.test(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `attribute key "${k}" rejected`,
        });
        return;
      }
    }
  });

export const processEventSchema = z.object({
  /** Stable identifier for the process flow (e.g. "loan_origination"). */
  processKey: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, "snake_case identifier"),
  /** One execution of the process — e.g. the application UUID. */
  caseId: z
    .string()
    .min(1)
    .max(120)
    .regex(EDGE_KEY_SAFE_RE, "caseId may not contain control characters"),
  /** Human-readable activity label, capped + sanitised. Edge-key safe. */
  activity: z
    .string()
    .min(1)
    .max(160)
    .regex(EDGE_KEY_SAFE_RE, "activity may not contain control characters"),
  actorKind: z.enum(ACTOR_KINDS),
  /** UUID for users, junior id for juniors, free-form for system. */
  actorId: z.string().min(1).max(120),
  attributes: attributesSchema.optional(),
  /** ISO 8601 timestamp the event actually happened (may pre-date now). */
  occurredAt: z.string().datetime(),
});
export type ProcessEventInput = z.infer<typeof processEventSchema>;

export interface ProcessEventRecord extends ProcessEventInput {
  readonly id: string;
  readonly orgId: string;
  readonly sequenceId: number;
  readonly prevHash: string | null;
  readonly rowHash: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Mined process map
// ---------------------------------------------------------------------------

/** A node in the directed-follows graph = one distinct activity label. */
export interface ProcessNode {
  readonly activity: string;
  /** How many times this activity was observed across all cases. */
  readonly occurrences: number;
  /** Mean / median / p95 dwell time at this activity (ms). */
  readonly durationMs: {
    readonly mean: number;
    readonly median: number;
    readonly p95: number;
  };
}

/** An edge = "activity A directly follows activity B" with frequency. */
export interface ProcessEdge {
  readonly from: string;
  readonly to: string;
  readonly frequency: number;
  /** Wait time between `from` end and `to` start, in ms. */
  readonly waitMs: {
    readonly mean: number;
    readonly median: number;
    readonly p95: number;
  };
}

/** A trace variant = one distinct sequence of activities across cases. */
export interface ProcessVariant {
  readonly id: string;
  readonly sequence: ReadonlyArray<string>;
  readonly caseCount: number;
  readonly meanDurationMs: number;
}

export interface ProcessMapGraph {
  readonly nodes: ReadonlyArray<ProcessNode>;
  readonly edges: ReadonlyArray<ProcessEdge>;
  readonly variants: ReadonlyArray<ProcessVariant>;
  /** The activity each case started at (>=80% of cases for fitness). */
  readonly startActivities: ReadonlyArray<string>;
  /** Same for end activities. */
  readonly endActivities: ReadonlyArray<string>;
}

export interface ProcessMapMetrics {
  readonly traceCount: number;
  readonly distinctVariants: number;
  readonly meanCaseDurationMs: number;
  readonly medianCaseDurationMs: number;
  readonly p95CaseDurationMs: number;
  /** Fraction of cases that follow the most common variant. */
  readonly commonVariantShare: number;
  /** "Reworks": activities that appear more than once in a single case. */
  readonly reworkRate: number;
}

export interface ProcessMapRecord {
  readonly id: string;
  readonly orgId: string;
  readonly processKey: string;
  readonly version: number;
  readonly graph: ProcessMapGraph;
  readonly metrics: ProcessMapMetrics;
  readonly traceCount: number;
  readonly windowStartedAt: string;
  readonly windowEndedAt: string;
  readonly minedBy: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Bottleneck / rework / parallel-gap detection
// ---------------------------------------------------------------------------

export const BOTTLENECK_KINDS = [
  "wait_time",
  "rework_loop",
  "parallel_gap",
  "low_throughput",
  "high_variance",
] as const;
export type BottleneckKind = (typeof BOTTLENECK_KINDS)[number];

export interface Bottleneck {
  readonly kind: BottleneckKind;
  /** Where in the graph the bottleneck lives. */
  readonly anchor:
    | { readonly node: string }
    | { readonly edge: { from: string; to: string } };
  /** Quantified severity in (0, 1] — used for prioritisation. */
  readonly severity: number;
  /** Human-readable explanation. */
  readonly explanation: string;
  /** Optional metric snapshot for the dashboard. */
  readonly evidence: Readonly<Record<string, number | string>>;
}

// ---------------------------------------------------------------------------
// Redesign proposal
// ---------------------------------------------------------------------------

export const REDESIGN_CHANGE_KINDS = [
  "add_activity",
  "remove_activity",
  "reorder_edge",
  "parallelise",
  "introduce_decision",
  "automate_activity",
  "consolidate_activities",
] as const;
export type RedesignChangeKind = (typeof REDESIGN_CHANGE_KINDS)[number];

export const redesignChangeSchema = z.object({
  kind: z.enum(REDESIGN_CHANGE_KINDS),
  target: z.string().min(1).max(160),
  description: z.string().min(8).max(2000),
  /** Pre-conditions the change assumes (e.g. "KYC stays mandatory"). */
  invariants: z.array(z.string().min(1).max(400)).max(8).optional(),
});
export type RedesignChange = z.infer<typeof redesignChangeSchema>;

export const expectedImpactSchema = z.object({
  /** Estimated cycle-time saving as a percentage in (0,100]. */
  cycleTimeSavingPct: z.number().min(0).max(100).optional(),
  /** Estimated cost saving as a number (currency-agnostic; tag in unit). */
  costSavingMonthly: z.number().nonnegative().optional(),
  unit: z.string().max(8).optional(),
  /** Risk surface introduced by the change (regulatory, ops, etc). */
  risks: z.array(z.string().min(4).max(400)).max(8).optional(),
});
export type ExpectedImpact = z.infer<typeof expectedImpactSchema>;

export const citationSchema = z.object({
  /** Source URL. H-4: must be http(s); rejects file://, javascript:,
   *  data:. Private IP filtering is the adapter's responsibility
   *  before this point. */
  url: z
    .string()
    .url()
    .max(2_000)
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "url must be http(s)",
    }),
  title: z.string().min(1).max(400),
  /** Pull-quote substantiating the recommendation. */
  quote: z.string().min(8).max(2_000),
});
export type Citation = z.infer<typeof citationSchema>;

// ---------------------------------------------------------------------------
// Web-research fetcher contract — branded callable
// ---------------------------------------------------------------------------

/**
 * H-3: the researcher junior accepts a fetcher callable, but ANY
 * function signature would satisfy `(q: string) => Promise<Citation[]>`
 * — including an attacker-supplied SSRF-on-private-IP closure. We
 * brand the type with a registry symbol so the only way to obtain a
 * `WebResearchFetcher` is via `markAsWebResearchFetcher()`, which the
 * brain's vetted web-research-adapter calls. The runtime brand check
 * (`isWebResearchFetcher`) uses the same registry key so cross-module
 * boundaries don't lose the brand.
 */
const WEB_RESEARCH_BRAND = Symbol.for("md.process-mining.web-research-fetcher");

export type WebResearchFetcher = ((
  query: string,
) => Promise<ReadonlyArray<Citation>>) & {
  readonly [WEB_RESEARCH_BRAND]: true;
};

/** Wrap a raw fetcher with the brand. Caller is responsible for the
 *  adapter's safety guarantees (SSRF defence, rate limits, secret
 *  redaction). The brand only attests "this was reviewed". */
export function markAsWebResearchFetcher(
  fetcher: (query: string) => Promise<ReadonlyArray<Citation>>,
): WebResearchFetcher {
  return Object.assign(fetcher, { [WEB_RESEARCH_BRAND]: true as const });
}

/** Runtime brand check. The Zod custom validator uses this. */
export function isWebResearchFetcher(v: unknown): v is WebResearchFetcher {
  if (typeof v !== "function") return false;
  const branded = v as unknown as { [k: symbol]: unknown };
  return branded[WEB_RESEARCH_BRAND] === true;
}

export const redesignProposalSchema = z.object({
  orgId: z.string().uuid(),
  processKey: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  baseMapId: z.string().uuid(),
  proposerKind: z.enum(["junior", "owner", "consultant"]),
  proposerId: z.string().min(1).max(120),
  changeset: z.array(redesignChangeSchema).min(1).max(16),
  expectedImpact: expectedImpactSchema,
  citations: z.array(citationSchema).max(16).optional(),
  rationale: z.string().min(16).max(4_000),
});
export type RedesignProposalInput = z.infer<typeof redesignProposalSchema>;

export const REDESIGN_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "superseded",
] as const;
export type RedesignStatus = (typeof REDESIGN_STATUSES)[number];

export interface ProcessRedesignRecord extends RedesignProposalInput {
  readonly id: string;
  readonly status: RedesignStatus;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectReason: string | null;
  readonly executed: boolean;
  readonly executedAt: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Automation manifest (frozen until the second 4-eye gate)
// ---------------------------------------------------------------------------

export const AUTOMATION_STEP_KINDS = [
  "spawn_junior",
  "schedule_action",
  "send_notification",
  "write_audit",
  "open_artifact",
  "invoke_skill",
  "evaluate_condition",
] as const;
export type AutomationStepKind = (typeof AUTOMATION_STEP_KINDS)[number];

export const automationStepSchema = z.object({
  kind: z.enum(AUTOMATION_STEP_KINDS),
  /** Stable id within the manifest (for cross-step references). */
  stepId: z.string().min(1).max(80),
  /** Resolves to a registered tool / skill / junior. */
  target: z.string().min(1).max(160),
  /** Step payload, JSON-serialisable; validated by the target at run time. */
  payload: z.record(z.string(), z.unknown()).optional(),
  /** Inline guardrails — overlays the target's defaults. */
  guardrails: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).optional(),
      timeoutMs: z.number().int().min(100).max(120_000).optional(),
      requiresApproval: z.boolean().optional(),
    })
    .optional(),
});
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationManifestSchema = z.object({
  orgId: z.string().uuid(),
  processKey: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  redesignId: z.string().uuid(),
  steps: z.array(automationStepSchema).min(1).max(32),
  riskTier: z.enum(["low", "medium", "high", "critical"]),
});
export type AutomationManifestInput = z.infer<typeof automationManifestSchema>;

export const AUTOMATION_STATUSES = [
  "draft",
  "active",
  "paused",
  "retired",
] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export interface AutomationManifestRecord {
  readonly id: string;
  readonly orgId: string;
  readonly processKey: string;
  readonly redesignId: string;
  readonly manifest: { readonly steps: ReadonlyArray<AutomationStep> };
  readonly riskTier: AutomationManifestInput["riskTier"];
  readonly status: AutomationStatus;
  readonly activatedAt: string | null;
  readonly activatedBy: string | null;
  readonly pausedAt: string | null;
  readonly pausedBy: string | null;
  readonly retiredAt: string | null;
  readonly retiredBy: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Canary / conformance
// ---------------------------------------------------------------------------

export interface CanaryDivergence {
  readonly stepId: string;
  /** What the legacy process produced for this step. */
  readonly legacyValue: unknown;
  readonly automationValue: unknown;
  /** Quantified divergence in (0, 1]; 0 = identical, 1 = entirely different. */
  readonly delta: number;
  readonly explanation: string;
}

export interface CanaryRunRecord {
  readonly id: string;
  readonly orgId: string;
  readonly processKey: string;
  readonly manifestId: string;
  readonly caseId: string;
  readonly legacyOutcome: unknown;
  readonly automationOutcome: unknown;
  readonly conformanceScore: number;
  readonly divergences: ReadonlyArray<CanaryDivergence>;
  readonly legacyDurationMs: number;
  readonly automationDurationMs: number;
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// Pipeline coordinator — the HITL-gated chain shape
// ---------------------------------------------------------------------------

export const PIPELINE_STAGES = [
  "observed",
  "mapped",
  "diagnosed",
  "researched",
  "redesigned",
  "automated",
  "verified",
  "active",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Where in the pipeline this process currently sits. Used by the UI
 *  to render the "next approval" surface and gate transitions. */
export interface PipelineState {
  readonly orgId: string;
  readonly processKey: string;
  readonly stage: PipelineStage;
  /** Last successful artifact id at each stage (when applicable). */
  readonly artifacts: Readonly<{
    mapId?: string;
    redesignId?: string;
    manifestId?: string;
  }>;
  readonly updatedAt: string;
}
