/**
 * `process-verifier` — junior that runs a canary against a draft
 * `AutomationManifest` and produces a `ConformanceReport` row in
 * `process_canary_runs`.
 *
 * Pipeline stage 9 (after stage 8's second-eye activation request,
 * before flipping `status='active'`). The verifier replays a sample
 * of legacy traces through the candidate manifest's step shapes and
 * computes:
 *   - per-trace fitness (token-replay style; checkConformance util)
 *   - aggregate conformance score in [0, 1]
 *   - divergences with per-step delta
 *
 * The junior does NOT execute the manifest — that requires the
 * activation gate's approval. It REPLAYS traces against the manifest
 * SHAPE (what activities the steps cover) so we can measure
 * coverage + drift before any side effect.
 *
 * @module features/central-command/md/juniors/agents/process-verifier-junior
 */

import { z } from "zod";

import { checkConformance } from "../../process-mining/conformance-checker";
import type {
  AutomationManifestRecord,
  CanaryDivergence,
  ProcessEventRecord,
  ProcessMapGraph,
} from "../../process-mining/types";

import type { JuniorRunContext, JuniorRunResult, MdJuniorPort } from "../types";

// iter-50-final: every write to a tier-scoped table MUST be preceded by
// `assertTierPolicy`. The verifier persists one `process_canary_runs`
// row per replayed trace; the prior implementation skipped the
// governance check entirely.
import {
  assertTierPolicy,
  type TierAction,
} from "@/core/governance/tier-policy";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

export interface ProcessVerifierSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
  };
}

// iter-50-final M4 fix: validate `processKey` before it crosses the
// persistence boundary. The org-supplied manifest carries a free-form
// `processKey` that ends up in the verdict summary AND the
// `process_canary_runs.process_key` row. Restrict to lowercase
// alphanumeric + underscore so a malicious org cannot stuff
// punctuation / quotes / control bytes into either surface.
const ProcessKeySchema = z
  .string()
  .regex(
    /^[a-z0-9_]{1,64}$/,
    "processKey must be lowercase alphanumeric + underscore, 1-64 chars",
  );

export const verifierPayloadSchema = z.object({
  /** The draft manifest under test. */
  manifest: z.custom<AutomationManifestRecord>(
    (v): v is AutomationManifestRecord =>
      !!v && typeof v === "object" && "manifest" in v && "redesignId" in v,
  ),
  /** Sample of legacy traces (sequences of activities + caseId)
   *  used to compute conformance. Typically the last N completed
   *  cases the mapper already produced. */
  legacyTraces: z
    .array(
      z.object({
        caseId: z.string().min(1).max(120),
        sequence: z.array(z.string().min(1).max(160)).min(1).max(256),
      }),
    )
    .min(1)
    .max(200),
  /** The mined graph the manifest is supposed to mirror. */
  targetGraph: z.custom<ProcessMapGraph>(
    (v): v is ProcessMapGraph => !!v && typeof v === "object",
  ),
  /** Supabase handle the canary row is persisted with. */
  supabase: z.custom<ProcessVerifierSupabaseLike>(
    (v): v is ProcessVerifierSupabaseLike =>
      !!v && typeof (v as { from?: unknown }).from === "function",
  ),
});
export type VerifierPayload = z.infer<typeof verifierPayloadSchema>;

// ---------------------------------------------------------------------------
// Junior port
// ---------------------------------------------------------------------------

export const processVerifierJunior: MdJuniorPort = Object.freeze({
  id: "process-verifier",
  label: "Process — Verifier",
  domain: "ops",
  trigger: { kind: "manual" as const, invokedBy: "pipeline" },
  guardrails: {
    maxRowsPerRun: 200,
    maxProposalsPerRun: 0,
    cooldownMs: 60_000,
    maxDurationMs: 30_000,
    allowedTables: [],
  },
  payloadSchema: verifierPayloadSchema,
  description:
    "Replays legacy traces against a draft AutomationManifest to measure conformance + surface divergences. Writes one process_canary_runs row per trace and a summary the activation gate consults.",
  async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
    const payload = ctx.payload as VerifierPayload;

    if (payload.manifest.status !== "draft") {
      return {
        outcome: "skipped_policy",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary: `Manifest status is "${payload.manifest.status}"; verifier only runs against drafts.`,
        errorMessage: "non_draft_manifest",
      };
    }

    // iter-50-final M4 fix: `processKey` is org-supplied and lands in
    // the verdict summary string AND `process_canary_runs.process_key`.
    // Refuse to run the canary if it does not match the documented
    // shape, BEFORE any persist call below.
    const processKeyParsed = ProcessKeySchema.safeParse(
      payload.manifest.processKey,
    );
    if (!processKeyParsed.success) {
      return {
        outcome: "ok",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary:
          "Invalid process_key — refusing to run canary. → verdict: BLOCK.",
      };
    }

    // Compute conformance against the target graph for the supplied
    // legacy traces. The `manifest.steps[].target` set defines the
    // canary's "expected activities" — any trace activity not covered
    // by a step is a divergence candidate.
    const stepTargets = new Set(
      payload.manifest.manifest.steps.map((s) => s.target),
    );

    // iter-50-final M5 fix: fail-closed when a manifest declares zero
    // step targets. The previous code allowed an empty stepTargets to
    // pass the divergence loop (the `stepTargets.size > 0` guard skipped
    // the check), which trivially produced a 100%-conformant verdict
    // and clickthrough-promoted manifests with no real coverage. A
    // zero-target manifest is by definition unverifiable — return
    // BLOCK so the operator must re-author with explicit steps.
    if (stepTargets.size === 0) {
      return {
        outcome: "ok",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary:
          `Manifest ${payload.manifest.id} declares zero step targets; ` +
          `cannot verify coverage. → verdict: BLOCK.`,
      };
    }

    const conf = checkConformance(payload.targetGraph, payload.legacyTraces);

    const perCaseDivergences = new Map<
      string,
      ReadonlyArray<CanaryDivergence>
    >();
    let aggregateScore = conf.aggregateFitness;
    let totalDivergences = 0;

    for (const trace of conf.perTrace) {
      const divergences: CanaryDivergence[] = [];
      // Activities the canary doesn't cover via any manifest step.
      for (const a of payload.legacyTraces.find(
        (t) => t.caseId === trace.caseId,
      )?.sequence ?? []) {
        if (!stepTargets.has(a) && stepTargets.size > 0) {
          divergences.push(
            Object.freeze({
              stepId: "(unmapped)",
              legacyValue: a,
              automationValue: null,
              delta: 0.5,
              explanation: `Activity "${a}" has no corresponding manifest step.`,
            }),
          );
        }
      }
      perCaseDivergences.set(trace.caseId, Object.freeze(divergences));
      totalDivergences += divergences.length;
    }

    if (totalDivergences > 0) {
      aggregateScore = Math.round(aggregateScore * 1000) / 1000; // already rounded
    }

    // iter-50-final: governance gate. Persisting a canary run is a
    // borjie-admin-tier write — the row is consumed by the activation
    // gate to flip a draft manifest to `active`. Skipping
    // `assertTierPolicy` here would be a hard rule violation
    // (CLAUDE.md: "Any new write call must call assertTierPolicy").
    // We check once per junior invocation, not per-trace, because every
    // row in the loop is the same kind of write under the same tier.
    const tierVerdict = assertTierPolicy(
      "borjie-admin",
      "process-mining.canary-run" as unknown as TierAction,
    );
    if (!tierVerdict.ok) {
      return {
        outcome: "skipped_policy",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary: `TierPolicy denied process-mining.canary-run for manifest ${payload.manifest.id}: ${tierVerdict.reason}`,
        errorMessage: "tier_policy_denied",
      };
    }

    // Persist one canary row per legacy trace.
    let persisted = 0;
    for (const trace of payload.legacyTraces) {
      const conformanceTrace = conf.perTrace.find(
        (t) => t.caseId === trace.caseId,
      );
      const divergences =
        perCaseDivergences.get(trace.caseId) ?? Object.freeze([]);
      try {
        const ins = await payload.supabase.from("process_canary_runs").insert([
          {
            org_id: ctx.orgId,
            process_key: payload.manifest.processKey,
            manifest_id: payload.manifest.id,
            case_id: trace.caseId,
            legacy_outcome: { sequence: trace.sequence },
            automation_outcome: {
              stepTargets: [...stepTargets],
              manifestSteps: payload.manifest.manifest.steps.length,
            },
            conformance_score: conformanceTrace?.fitness ?? 0,
            divergences,
            legacy_duration_ms: null,
            automation_duration_ms: null,
          },
        ]);
        const err = (ins as { error?: { message: string } | null }).error;
        if (!err) persisted += 1;
      } catch {
        /* per-trace persistence failures are non-fatal; the run
         * outcome summary surfaces the gap. */
      }
    }

    const verdict =
      aggregateScore >= 0.9
        ? "READY"
        : aggregateScore >= 0.7
          ? "REVIEW"
          : "BLOCK";

    return {
      outcome: "ok",
      proposalsFiled: 0,
      rowsProcessed: persisted,
      summary:
        `Canary complete for manifest ${payload.manifest.id}: ` +
        `aggregate fitness ${(aggregateScore * 100).toFixed(1)}%, ` +
        `${persisted}/${payload.legacyTraces.length} traces persisted, ` +
        `${totalDivergences} divergence${totalDivergences === 1 ? "" : "s"} ` +
        `→ verdict: ${verdict}.`,
    };
  },
});

export type { ProcessEventRecord };
