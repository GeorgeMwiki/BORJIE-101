/**
 * MD junior-agent contract.
 *
 * A "junior" is a narrow-scope worker the MD spawns to handle a class
 * of recurring work (HR CSV ingest, finance reconciliation, supplier
 * onboarding, …). The contract is deliberately minimal and mirrors
 * Borjie101's TaskAgent (`packages/ai-copilot/src/task-agents/`)
 * with two adaptations for Borjie's tier-policy world:
 *
 *   1. Every run is bracketed by an audit row in `junior_runs` with a
 *      per-org hash chain (see executor.ts) — same tamper-evidence
 *      pattern the staged-call audit log uses.
 *   2. Guardrails are declarative: `maxRowsPerRun`, `maxProposals`,
 *      `cooldownMs`. The executor enforces them; juniors stay pure.
 *
 * A junior NEVER writes to a production row table directly. Its only
 * write surface is `field_proposals` (via {@link SchemaRegistryService})
 * and its own `junior_runs` audit row. Materialising a proposal is the
 * owner's 4-eye decision.
 *
 * @module features/central-command/md/juniors/types
 */

import { z } from "zod";

import type { SchemaRegistryService } from "../schema-registry/schema-registry-service";
import type { TableKey } from "../schema-registry/types";

// ---------------------------------------------------------------------------
// Trigger shapes
// ---------------------------------------------------------------------------

/**
 * Manual: a user (or the MD itself) invoked the junior with a payload
 * (e.g. an uploaded CSV blob).
 */
export const manualTriggerSchema = z.object({
  kind: z.literal("manual"),
  invokedBy: z.string().min(1).max(120),
});

/**
 * Cron: heartbeat-style schedule. Matches the standard 5-field cron
 * grammar used elsewhere in `src/core/heartbeat/`.
 */
export const cronTriggerSchema = z.object({
  kind: z.literal("cron"),
  cron: z
    .string()
    .min(9)
    .max(120)
    .regex(/^(\S+\s+){4}\S+$/, "5-field cron expression"),
});

/**
 * Event: junior wakes when a domain event fires (e.g. "csv.uploaded",
 * "supplier.invoice.received"). Wired up to the event bus by the host.
 */
export const eventTriggerSchema = z.object({
  kind: z.literal("event"),
  event: z.string().min(1).max(80),
});

export const triggerSchema = z.discriminatedUnion("kind", [
  manualTriggerSchema,
  cronTriggerSchema,
  eventTriggerSchema,
]);
export type JuniorTrigger = z.infer<typeof triggerSchema>;

// ---------------------------------------------------------------------------
// Guardrails — declarative limits the executor enforces.
// ---------------------------------------------------------------------------

export const guardrailsSchema = z.object({
  /** Maximum rows the junior may process in a single run. */
  maxRowsPerRun: z.number().int().positive().max(50_000).default(1_000),
  /** Maximum field proposals the junior may file in a single run. */
  maxProposalsPerRun: z.number().int().nonnegative().max(64).default(16),
  /** Minimum delay between runs of the SAME junior for the SAME org. */
  cooldownMs: z.number().int().nonnegative().max(86_400_000).default(60_000),
  /** Hard wall-clock cap. The executor aborts past this. */
  maxDurationMs: z.number().int().positive().max(300_000).default(30_000),
  /**
   * Allowed tables the junior may file proposals against. Empty array
   * means "no proposal writes" (read-only junior).
   */
  allowedTables: z
    .array(
      z.enum([
        "employees",
        "customers",
        "suppliers",
        "inventory",
        "finance",
        "leads",
        "products",
        "compliance",
      ]),
    )
    .max(8)
    .default([]),
});
export type Guardrails = z.infer<typeof guardrailsSchema>;

// ---------------------------------------------------------------------------
// Run context + result — what the executor passes to / collects from
// a junior's execute() method.
// ---------------------------------------------------------------------------

export interface JuniorRunContext {
  readonly orgId: string;
  readonly juniorId: string;
  readonly triggerKind: JuniorTrigger["kind"];
  /** Free-form payload provided by the trigger. The junior parses it
   *  with its own `payloadSchema`. */
  readonly payload: unknown;
  /** Schema-registry service the junior may use to file proposals. */
  readonly schemaRegistry: SchemaRegistryService;
  /** Effective guardrails for THIS run (may be tightened from defaults
   *  by the executor for one-off escalations). */
  readonly guardrails: Guardrails;
  /** Abort signal honoured by long-running juniors (e.g. LLM calls). */
  readonly signal: AbortSignal;
  /** Per-run correlation id surfaced into telemetry. */
  readonly runId: string;
}

export type JuniorOutcome = "ok" | "error" | "skipped_policy" | "rate_limited";

export interface JuniorRunResult {
  readonly outcome: JuniorOutcome;
  /** Filed proposals (count, not the rows — keep telemetry small). */
  readonly proposalsFiled: number;
  /** Rows touched by the junior (CSV lines parsed, records visited). */
  readonly rowsProcessed: number;
  /** Optional table the junior worked on, for telemetry routing. */
  readonly tableKey?: TableKey;
  /** Human-readable summary suitable for the MD chat log. */
  readonly summary: string;
  /** Set when outcome="error". */
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// MdJuniorPort — what each junior implements.
// ---------------------------------------------------------------------------

export interface MdJuniorPort {
  /** Stable identifier, e.g. "hr-csv-ingest". snake-kebab fine. */
  readonly id: string;
  /** Human label for the MD chat panel. */
  readonly label: string;
  /** What domain the junior owns; routes the MD's intent matching. */
  readonly domain:
    | "hr"
    | "finance"
    | "sales"
    | "supply"
    | "inventory"
    | "compliance"
    | "marketing"
    | "ops";
  /** Trigger contract. */
  readonly trigger: JuniorTrigger;
  /** Declarative guardrails (the executor enforces). */
  readonly guardrails: Guardrails;
  /** Zod schema the junior uses to validate its payload. */
  readonly payloadSchema: z.ZodSchema<unknown>;
  /** One-line description for the MD's "which juniors do I have?" prompt. */
  readonly description: string;
  /** Execute the junior. The executor wraps this with audit + guardrails. */
  execute(ctx: JuniorRunContext): Promise<JuniorRunResult>;
}

// ---------------------------------------------------------------------------
// Audit row shape — what the executor persists to `junior_runs`.
// ---------------------------------------------------------------------------

export interface JuniorRunRecord {
  readonly id: string;
  readonly orgId: string;
  readonly juniorId: string;
  readonly triggerKind: JuniorTrigger["kind"];
  readonly outcome: JuniorOutcome;
  readonly proposalsFiled: number;
  readonly rowsProcessed: number;
  readonly durationMs: number;
  readonly errorMessage: string | null;
  readonly sequenceId: number;
  readonly prevHash: string | null;
  readonly rowHash: string;
  readonly createdAt: string;
}
