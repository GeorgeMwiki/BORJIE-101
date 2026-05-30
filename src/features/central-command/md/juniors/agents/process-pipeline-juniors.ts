/**
 * Process-pipeline juniors — the agent pipeline that observes,
 * maps, diagnoses, researches, and redesigns a business process.
 *
 * Each junior is a narrow-scope worker with the same executor
 * contract every other junior uses (cooldown + hash-chained audit +
 * payload validation). HITL gates live OUTSIDE the juniors: the
 * pipeline coordinator chains them sequentially and pauses at each
 * approval point. A junior never silently advances the pipeline.
 *
 * Order of operations:
 *
 *   process-observer-junior  — append events to process_events
 *   process-mapper-junior    — read events, mine the map, persist
 *   process-diagnoser-junior — read latest map, surface bottlenecks
 *   process-researcher-junior — pull web research for each bottleneck
 *   process-redesigner-junior — propose a redesign for owner approval
 *
 * @module features/central-command/md/juniors/agents/process-pipeline-juniors
 */

import { z } from "zod";

import { checkConformance } from "../../process-mining/conformance-checker";
import { detectBottlenecks } from "../../process-mining/bottleneck-detector";
import { mineProcess } from "../../process-mining/process-miner";
import { proposeRedesign } from "../../process-mining/redesign-proposer";
import {
  isWebResearchFetcher,
  processEventSchema,
  type Citation,
  type ProcessEventRecord,
  type ProcessMapGraph,
  type ProcessMapMetrics,
  type RedesignProposalInput,
  type WebResearchFetcher,
} from "../../process-mining/types";

import type { JuniorRunContext, JuniorRunResult, MdJuniorPort } from "../types";

// ---------------------------------------------------------------------------
// Pipeline-context port — process-pipeline juniors need slightly more
// than the schema-registry juniors (an event-log handle + a process-
// map persister). We declare that as a "context augment" the executor
// injects via the JuniorRunContext.payload, NOT by widening the
// generic JuniorRunContext interface — that contract stays stable for
// every other junior.
// ---------------------------------------------------------------------------

export interface ProcessPipelineSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
  };
}

/** Payload for the observer junior — caller supplies events to append. */
export const observerPayloadSchema = z.object({
  processKey: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  events: z.array(processEventSchema).min(1).max(500),
  /** Supabase handle the executor passes via the payload (route-level). */
  supabase: z.custom<ProcessPipelineSupabaseLike>(
    (v): v is ProcessPipelineSupabaseLike =>
      !!v && typeof (v as { from?: unknown }).from === "function",
    "supabase handle required",
  ),
});
export type ObserverPayload = z.infer<typeof observerPayloadSchema>;

export const mapperPayloadSchema = z.object({
  processKey: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  /** ISO 8601 window the mapper reads from process_events. */
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  supabase: z.custom<ProcessPipelineSupabaseLike>(
    (v): v is ProcessPipelineSupabaseLike =>
      !!v && typeof (v as { from?: unknown }).from === "function",
    "supabase handle required",
  ),
  /** Cap on events the miner consumes; defaults to 50 000. */
  maxEvents: z.number().int().positive().max(500_000).optional(),
});
export type MapperPayload = z.infer<typeof mapperPayloadSchema>;

export const diagnoserPayloadSchema = z.object({
  /** A mined map artifact, either inlined or by id (caller's choice). */
  graph: z.custom<ProcessMapGraph>(
    (v): v is ProcessMapGraph => !!v && typeof v === "object",
    "graph required",
  ),
  metrics: z.custom<ProcessMapMetrics>(
    (v): v is ProcessMapMetrics => !!v && typeof v === "object",
    "metrics required",
  ),
});
export type DiagnoserPayload = z.infer<typeof diagnoserPayloadSchema>;

export const researcherPayloadSchema = z.object({
  processKey: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  bottlenecks: z
    .array(
      z.object({
        kind: z.string().min(1).max(40),
        severity: z.number().min(0).max(1),
        explanation: z.string().min(1).max(2000),
      }),
    )
    .max(16),
  /** H-3 hardening: fetcher must be a branded `WebResearchFetcher`.
   *  Only `markAsWebResearchFetcher()` produces this brand, and only
   *  the brain's vetted web-research-adapter is allowed to call it
   *  (lint check + code review enforce the import boundary). A raw
   *  closure passed in by an attacker fails the brand check. */
  fetcher: z.custom<WebResearchFetcher>(isWebResearchFetcher).optional(),
});
export type ResearcherPayload = z.infer<typeof researcherPayloadSchema>;

// M-4: strict per-element shape for bottlenecks instead of
// `z.custom Array.isArray`. Citations get the same treatment via the
// existing citationSchema.
const bottleneckShapeSchema = z.object({
  kind: z.enum([
    "wait_time",
    "rework_loop",
    "parallel_gap",
    "low_throughput",
    "high_variance",
  ]),
  anchor: z.union([
    z.object({ node: z.string().min(1).max(160) }),
    z.object({
      edge: z.object({
        from: z.string().min(1).max(160),
        to: z.string().min(1).max(160),
      }),
    }),
  ]),
  severity: z.number().min(0).max(1),
  explanation: z.string().min(1).max(2000),
  evidence: z.record(z.string(), z.union([z.number(), z.string()])),
});

export const redesignerPayloadSchema = z.object({
  processKey: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  baseMapId: z.string().uuid(),
  metrics: z.object({
    traceCount: z.number().int().nonnegative(),
    distinctVariants: z.number().int().nonnegative(),
    meanCaseDurationMs: z.number().nonnegative(),
    medianCaseDurationMs: z.number().nonnegative(),
    p95CaseDurationMs: z.number().nonnegative(),
    commonVariantShare: z.number().min(0).max(1),
    reworkRate: z.number().min(0).max(1),
  }),
  bottlenecks: z.array(bottleneckShapeSchema).max(16),
  citations: z
    .array(
      z.object({
        url: z
          .string()
          .url()
          .max(2_000)
          .refine((u) => /^https?:\/\//i.test(u), "url must be http(s)"),
        title: z.string().min(1).max(400),
        quote: z.string().min(8).max(2_000),
      }),
    )
    .max(16)
    .optional(),
});
export type RedesignerPayload = z.infer<typeof redesignerPayloadSchema>;

// ---------------------------------------------------------------------------
// Observer junior — appends events to the log
// ---------------------------------------------------------------------------

export const processObserverJunior: MdJuniorPort = Object.freeze({
  id: "process-observer",
  label: "Process — Observer",
  domain: "ops",
  trigger: { kind: "event" as const, event: "process.observe" },
  guardrails: {
    maxRowsPerRun: 500,
    maxProposalsPerRun: 0,
    cooldownMs: 0,
    maxDurationMs: 15_000,
    allowedTables: [],
  },
  payloadSchema: observerPayloadSchema,
  description:
    "Appends domain events to the per-org process_events log. Hash-chained, replay-safe.",
  async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
    const payload = ctx.payload as ObserverPayload;
    // The observer doesn't import the event-log service directly to
    // avoid a cyclical dep through index.ts; the route layer wires
    // the writer in via the supabase handle. We do the append inline
    // here using the same canonical-shape contract as the service.
    // The actual append uses makeEventLogService at the call site.
    const { makeEventLogService } =
      await import("../../process-mining/event-log-service");
    const svc = makeEventLogService({ supabase: payload.supabase });
    const result = await svc.appendMany(ctx.orgId, payload.events);
    return {
      outcome: result.failed.length === 0 ? "ok" : "error",
      proposalsFiled: 0,
      rowsProcessed: result.appended,
      summary: `Appended ${result.appended}/${payload.events.length} events to "${payload.processKey}".`,
      errorMessage:
        result.failed.length > 0
          ? `${result.failed.length} events failed; first: ${result.failed[0]!.error.slice(0, 200)}`
          : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// Mapper junior — reads events, mines the DFG, persists map row
// ---------------------------------------------------------------------------

export const processMapperJunior: MdJuniorPort = Object.freeze({
  id: "process-mapper",
  label: "Process — Mapper",
  domain: "ops",
  trigger: { kind: "manual" as const, invokedBy: "pipeline" },
  guardrails: {
    maxRowsPerRun: 500_000,
    maxProposalsPerRun: 0,
    cooldownMs: 60_000,
    maxDurationMs: 60_000,
    allowedTables: [],
  },
  payloadSchema: mapperPayloadSchema,
  description:
    "Reads events from the process log, mines a directly-follows graph, and writes a versioned process_maps row.",
  async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
    const payload = ctx.payload as MapperPayload;
    const { makeEventLogService } =
      await import("../../process-mining/event-log-service");
    const svc = makeEventLogService({ supabase: payload.supabase });
    const events = await svc.read(
      ctx.orgId,
      payload.processKey,
      payload.windowStart,
      payload.windowEnd,
      payload.maxEvents,
    );
    if (events.length === 0) {
      return {
        outcome: "ok",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary: `No events in window for "${payload.processKey}".`,
      };
    }
    const { graph, metrics } = mineProcess({ events });
    // Persist a process_maps row (the route layer does the version
    // numbering via a DB-side max-version read).
    const version = await readNextMapVersion(
      payload.supabase,
      ctx.orgId,
      payload.processKey,
    );
    try {
      const ins = await payload.supabase.from("process_maps").insert([
        {
          org_id: ctx.orgId,
          process_key: payload.processKey,
          version,
          graph,
          metrics,
          trace_count: metrics.traceCount,
          window_started_at: payload.windowStart,
          window_ended_at: payload.windowEnd,
          mined_by: `junior:${ctx.juniorId}`,
        },
      ]);
      const err = (ins as { error?: { message: string } | null }).error;
      if (err) {
        return {
          outcome: "error",
          proposalsFiled: 0,
          rowsProcessed: events.length,
          summary: `Map persist failed for "${payload.processKey}".`,
          errorMessage: err.message.slice(0, 500),
        };
      }
    } catch (e) {
      return {
        outcome: "error",
        proposalsFiled: 0,
        rowsProcessed: events.length,
        summary: `Map persist threw for "${payload.processKey}".`,
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
    return {
      outcome: "ok",
      proposalsFiled: 0,
      rowsProcessed: events.length,
      summary: `Mined v${version} of "${payload.processKey}" — ${metrics.traceCount} cases, ${metrics.distinctVariants} variants.`,
    };
  },
});

async function readNextMapVersion(
  supabase: ProcessPipelineSupabaseLike,
  orgId: string,
  processKey: string,
): Promise<number> {
  try {
    const r = await supabase
      .from("process_maps")
      .select("version")
      .eq("org_id", orgId)
      .eq("process_key", processKey)
      .order("version", { ascending: false })
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (Array.isArray(data) && data[0]) {
      const head = data[0] as { version?: number };
      return (head.version ?? 0) + 1;
    }
  } catch {
    /* fall through */
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Diagnoser junior — runs bottleneck detection on a passed-in map
// ---------------------------------------------------------------------------

export const processDiagnoserJunior: MdJuniorPort = Object.freeze({
  id: "process-diagnoser",
  label: "Process — Diagnoser",
  domain: "ops",
  trigger: { kind: "manual" as const, invokedBy: "pipeline" },
  guardrails: {
    maxRowsPerRun: 1_000,
    maxProposalsPerRun: 0,
    cooldownMs: 5_000,
    maxDurationMs: 15_000,
    allowedTables: [],
  },
  payloadSchema: diagnoserPayloadSchema,
  description:
    "Surfaces wait-time, rework, parallel-gap, low-throughput, and high-variance bottlenecks for the owner to triage.",
  async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
    const payload = ctx.payload as DiagnoserPayload;
    const bottlenecks = detectBottlenecks({
      graph: payload.graph,
      metrics: payload.metrics,
    });
    return {
      outcome: "ok",
      proposalsFiled: 0,
      rowsProcessed: bottlenecks.length,
      summary:
        bottlenecks.length === 0
          ? "Diagnosis clean — no actionable bottlenecks at the configured thresholds."
          : `Surfaced ${bottlenecks.length} bottleneck${bottlenecks.length === 1 ? "" : "s"}; top: ${bottlenecks[0]!.kind} (severity ${(bottlenecks[0]!.severity * 100).toFixed(0)}%).`,
    };
  },
});

// ---------------------------------------------------------------------------
// Researcher junior — runs web research for each bottleneck
// ---------------------------------------------------------------------------

export const processResearcherJunior: MdJuniorPort = Object.freeze({
  id: "process-researcher",
  label: "Process — Researcher",
  domain: "ops",
  trigger: { kind: "manual" as const, invokedBy: "pipeline" },
  guardrails: {
    maxRowsPerRun: 16,
    maxProposalsPerRun: 0,
    cooldownMs: 30_000,
    maxDurationMs: 45_000,
    allowedTables: [],
  },
  payloadSchema: researcherPayloadSchema,
  description:
    "Pulls citation-grade web research for each bottleneck. Defaults to no-op when no fetcher is wired (the route layer plugs the brain's web-research-adapter in).",
  async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
    const payload = ctx.payload as ResearcherPayload;
    if (!payload.fetcher) {
      return {
        outcome: "skipped_policy",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary: `Researcher had no fetcher wired; skipping (caller should pass a web-research adapter).`,
      };
    }
    const allCitations: Citation[] = [];
    let queriesRun = 0;
    for (const b of payload.bottlenecks) {
      if (ctx.signal.aborted) break;
      const query = buildResearchQuery(payload.processKey, b);
      try {
        const cits = await payload.fetcher(query);
        for (const c of cits) allCitations.push(c);
        queriesRun += 1;
      } catch {
        /* skip individual failures */
      }
    }
    return {
      outcome: "ok",
      proposalsFiled: 0,
      rowsProcessed: queriesRun,
      summary: `Pulled ${allCitations.length} citation${allCitations.length === 1 ? "" : "s"} across ${queriesRun} bottleneck queries.`,
    };
  },
});

function buildResearchQuery(
  processKey: string,
  b: { kind: string; explanation: string },
): string {
  const verbForKind: Record<string, string> = {
    wait_time: "reduce wait time",
    rework_loop: "eliminate rework",
    parallel_gap: "synchronise parallel paths",
    low_throughput: "improve throughput",
    high_variance: "reduce dwell variance",
  };
  const verb = verbForKind[b.kind] ?? "improve";
  return `${verb} ${processKey.replace(/_/g, " ")} best practices`;
}

// ---------------------------------------------------------------------------
// Redesigner junior — proposes the redesign for owner approval
// ---------------------------------------------------------------------------

export const processRedesignerJunior: MdJuniorPort = Object.freeze({
  id: "process-redesigner",
  label: "Process — Redesigner",
  domain: "ops",
  trigger: { kind: "manual" as const, invokedBy: "pipeline" },
  guardrails: {
    maxRowsPerRun: 16,
    maxProposalsPerRun: 1,
    cooldownMs: 60_000,
    maxDurationMs: 20_000,
    allowedTables: [],
  },
  payloadSchema: redesignerPayloadSchema,
  description:
    "Composes a concrete RedesignProposal from the diagnosed bottlenecks + cited research. Owner approval is required before the redesign materialises into an automation manifest.",
  async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
    const payload = ctx.payload as RedesignerPayload;
    const proposal: RedesignProposalInput | null = proposeRedesign({
      orgId: ctx.orgId,
      processKey: payload.processKey,
      baseMapId: payload.baseMapId,
      metrics: payload.metrics,
      bottlenecks: payload.bottlenecks,
      proposerId: ctx.juniorId,
      citations: payload.citations,
    });
    if (!proposal) {
      return {
        outcome: "ok",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary:
          "No actionable redesign — bottleneck list was empty or unmappable.",
      };
    }
    // We DO NOT persist here. The pipeline coordinator persists the
    // pending row (it owns the HITL pause). The junior's role ends at
    // producing the proposal artifact.
    return {
      outcome: "ok",
      proposalsFiled: 1,
      rowsProcessed: proposal.changeset.length,
      summary: `Proposed ${proposal.changeset.length} change${proposal.changeset.length === 1 ? "" : "s"} for "${payload.processKey}" (est. ${proposal.expectedImpact.cycleTimeSavingPct?.toFixed(1) ?? "?"}% cycle saving). Awaiting owner approval.`,
    };
  },
});

// ---------------------------------------------------------------------------
// All pipeline juniors, in order.
// ---------------------------------------------------------------------------

export const PROCESS_PIPELINE_JUNIORS: ReadonlyArray<MdJuniorPort> =
  Object.freeze([
    processObserverJunior,
    processMapperJunior,
    processDiagnoserJunior,
    processResearcherJunior,
    processRedesignerJunior,
  ]);

// Re-export conformance for the verifier's future use.
export { checkConformance };

// Suppress unused-import lint when only checkConformance is consumed
// downstream — it's intentional for callers that want the checker
// alongside the juniors.
export type { ProcessEventRecord };
