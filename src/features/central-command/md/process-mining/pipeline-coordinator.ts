/**
 * Process pipeline coordinator.
 *
 * Chains the 5 pipeline juniors in order, pausing at every HITL gate.
 * The coordinator is a thin orchestrator — it does NOT make policy
 * decisions, it surfaces each artifact as a separate API + UI signal
 * so the operator can review, edit, approve, or reject.
 *
 * Stages (each one writes its artifact + emits a `PipelineState`):
 *
 *   1. observe   — pipeline-coordinator collects events from upstream
 *                  signals (chat, API hooks). The juniors only persist;
 *                  trigger is upstream.
 *   2. map       — operator triggers the mapper-junior on a window
 *   3. diagnose  — operator clicks "diagnose this map"
 *   4. research  — operator clicks "research the top bottleneck"
 *   5. redesign  — operator clicks "propose redesign" → pending row
 *   6. approve   — operator hits Approve on the redesign (4-eye 1)
 *   7. automate  — automator-junior emits draft manifest
 *   8. activate  — operator hits Activate on the manifest (4-eye 2)
 *   9. verify    — verifier-junior runs canary, conformance gate
 *  10. live      — automation switches to status=active
 *
 * This file ships stages 1-6 (the foundation). Stages 7-10 land in a
 * later wave when the automator + verifier juniors ship.
 *
 * The coordinator is pure — caller supplies the executor and the
 * pipeline state store (DB-backed).
 *
 * @module features/central-command/md/process-mining/pipeline-coordinator
 */

import { createLogger } from "@/lib/logger";

import type { JuniorExecutor, JuniorRegistry } from "../juniors";

import { detectBottlenecks } from "./bottleneck-detector";
import { proposeRedesign } from "./redesign-proposer";
import type {
  AutomationManifestRecord,
  Bottleneck,
  Citation,
  ProcessMapMetrics,
  ProcessRedesignRecord,
  RedesignProposalInput,
  WebResearchFetcher,
} from "./types";

const log = createLogger("md.process-mining.pipeline-coordinator");

export interface PipelineSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
  };
}

export interface PipelineCoordinatorDeps {
  readonly executor: JuniorExecutor;
  readonly registry: JuniorRegistry;
  readonly supabase: PipelineSupabaseLike;
  /** Optional web-research adapter the researcher junior uses.
   *  H-3: must be a `WebResearchFetcher` (branded). The brain's
   *  web-research-adapter exports a `markAsWebResearchFetcher`
   *  helper to produce one. */
  readonly webResearch?: WebResearchFetcher;
}

export interface PipelineStageResult {
  readonly ok: boolean;
  readonly stage:
    | "map"
    | "diagnose"
    | "research"
    | "redesign"
    | "automate"
    | "verify";
  readonly artifactId?: string;
  readonly summary: string;
  readonly error?: string;
}

/**
 * Verdict the verifier emits to gate stage 10 (activation flip).
 * Aggregate conformance ≥ 0.9 → READY, 0.7–0.9 → REVIEW, < 0.7 → BLOCK.
 * Persisted in the canary summary so the activation route can short-
 * circuit at REVIEW (require explicit operator override) or BLOCK
 * (refuse to flip even with operator click).
 */
export type VerifierVerdict = "READY" | "REVIEW" | "BLOCK";

export interface PipelineCoordinator {
  /** Stage 2: mine a process_maps row from the event log window. */
  runMap(args: {
    readonly orgId: string;
    readonly processKey: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly maxEvents?: number;
  }): Promise<PipelineStageResult & { readonly mapId?: string }>;

  /** Stage 3: diagnose a persisted map. */
  runDiagnose(args: {
    readonly orgId: string;
    readonly mapId: string;
  }): Promise<
    PipelineStageResult & {
      readonly bottlenecks?: ReadonlyArray<Bottleneck>;
      readonly metrics?: ProcessMapMetrics;
    }
  >;

  /** Stage 4: pull web research for the bottlenecks. */
  runResearch(args: {
    readonly orgId: string;
    readonly processKey: string;
    readonly bottlenecks: ReadonlyArray<Bottleneck>;
  }): Promise<
    PipelineStageResult & {
      readonly citations?: ReadonlyArray<Citation>;
    }
  >;

  /** Stage 5: propose a redesign artifact and persist it pending. */
  runRedesign(args: {
    readonly orgId: string;
    readonly processKey: string;
    readonly baseMapId: string;
    readonly metrics: ProcessMapMetrics;
    readonly bottlenecks: ReadonlyArray<Bottleneck>;
    readonly citations?: ReadonlyArray<Citation>;
  }): Promise<PipelineStageResult & { readonly redesignId?: string }>;

  /**
   * Stage 7: hand the post-approval redesign to the automator junior,
   * which codegens an AutomationManifest + persists it as `status='draft'`.
   *
   * The caller MUST have run the first 4-eye approval gate (stage 6)
   * before invoking this — the automator's `payloadSchema` guard
   * rejects redesigns whose `executed=false`.
   */
  runAutomate(args: {
    readonly orgId: string;
    readonly redesignId: string;
  }): Promise<PipelineStageResult & { readonly manifestId?: string }>;

  /**
   * Stage 9: hand the draft manifest to the verifier junior, which
   * replays legacy traces from the source `process_maps` row and
   * persists per-trace canary rows.
   *
   * Returns the aggregate verdict so the activation route can gate
   * the second 4-eye approval (stage 8 already gathered the
   * approvers; stage 10's flip-to-active route consults this verdict).
   */
  runVerify(args: {
    readonly orgId: string;
    readonly manifestId: string;
    /** How many recent legacy traces to replay. Defaults to 50. */
    readonly traceSampleSize?: number;
  }): Promise<
    PipelineStageResult & {
      readonly verdict?: VerifierVerdict;
      readonly tracesReplayed?: number;
    }
  >;
}

export function makePipelineCoordinator(
  deps: PipelineCoordinatorDeps,
): PipelineCoordinator {
  const { executor, registry, supabase, webResearch } = deps;

  function getJunior(id: string) {
    const j = registry.get(id);
    if (!j) {
      throw new Error(
        `[md.process-mining.pipeline] junior "${id}" not registered`,
      );
    }
    return j;
  }

  const coordinator: PipelineCoordinator = Object.freeze({
    async runMap({
      orgId,
      processKey,
      windowStart,
      windowEnd,
      maxEvents,
    }: {
      orgId: string;
      processKey: string;
      windowStart: string;
      windowEnd: string;
      maxEvents?: number;
    }) {
      const j = getJunior("process-mapper");
      const out = await executor.run({
        junior: j,
        orgId,
        triggerKind: "manual",
        payload: { processKey, windowStart, windowEnd, supabase, maxEvents },
      });
      if (out.result.outcome !== "ok") {
        return {
          ok: false,
          stage: "map" as const,
          summary: out.result.summary,
          error: out.result.errorMessage,
        };
      }
      // The mapper persists the row; we read back the freshest one.
      const mapId = await readLatestMapId(supabase, orgId, processKey);
      return {
        ok: true,
        stage: "map" as const,
        artifactId: mapId,
        mapId,
        summary: out.result.summary,
      };
    },

    async runDiagnose({ orgId, mapId }: { orgId: string; mapId: string }) {
      // Load the map.
      const map = await readMapRow(supabase, orgId, mapId);
      if (!map) {
        return {
          ok: false,
          stage: "diagnose" as const,
          summary: "Map not found.",
          error: "not_found",
        };
      }
      const j = getJunior("process-diagnoser");
      const out = await executor.run({
        junior: j,
        orgId,
        triggerKind: "manual",
        payload: { graph: map.graph, metrics: map.metrics },
      });
      if (out.result.outcome !== "ok") {
        return {
          ok: false,
          stage: "diagnose" as const,
          summary: out.result.summary,
          error: out.result.errorMessage,
        };
      }
      // Re-run the detector to surface the actual bottlenecks (the
      // junior's summary is just the count + top severity).
      const bottlenecks = detectBottlenecks({
        graph: map.graph,
        metrics: map.metrics,
      });
      return {
        ok: true,
        stage: "diagnose" as const,
        bottlenecks,
        metrics: map.metrics,
        summary: out.result.summary,
      };
    },

    async runResearch({
      orgId,
      processKey,
      bottlenecks,
    }: {
      orgId: string;
      processKey: string;
      bottlenecks: ReadonlyArray<Bottleneck>;
    }) {
      const j = getJunior("process-researcher");
      const out = await executor.run({
        junior: j,
        orgId,
        triggerKind: "manual",
        payload: {
          processKey,
          bottlenecks: bottlenecks.map((b) => ({
            kind: b.kind,
            severity: b.severity,
            explanation: b.explanation,
          })),
          fetcher: webResearch,
        },
      });
      if (out.result.outcome !== "ok") {
        return {
          ok: false,
          stage: "research" as const,
          summary: out.result.summary,
          error: out.result.errorMessage,
          citations: [] as ReadonlyArray<Citation>,
        };
      }
      // The junior doesn't return the citations directly (its result
      // is summary-only). The coordinator re-runs the fetcher itself
      // when a webResearch handle is wired, so callers get the
      // citations back in one call.
      const citations = webResearch
        ? await collectCitations(processKey, bottlenecks, webResearch)
        : [];
      return {
        ok: true,
        stage: "research" as const,
        citations,
        summary: out.result.summary,
      };
    },

    async runRedesign({
      orgId,
      processKey,
      baseMapId,
      metrics,
      bottlenecks,
      citations,
    }: {
      orgId: string;
      processKey: string;
      baseMapId: string;
      metrics: ProcessMapMetrics;
      bottlenecks: ReadonlyArray<Bottleneck>;
      citations?: ReadonlyArray<Citation>;
    }) {
      const j = getJunior("process-redesigner");
      const out = await executor.run({
        junior: j,
        orgId,
        triggerKind: "manual",
        payload: {
          processKey,
          baseMapId,
          metrics,
          bottlenecks,
          citations,
        },
      });
      if (out.result.outcome !== "ok" || out.result.proposalsFiled === 0) {
        return {
          ok: false,
          stage: "redesign" as const,
          summary: out.result.summary,
          error: out.result.errorMessage,
        };
      }
      // The junior produced the proposal but doesn't write — the
      // coordinator persists the pending row so the owner can approve
      // through the existing /api/central-command/md/schema-proposals
      // -equivalent route (we'll expose process-redesigns in a later
      // wave).
      const proposal = buildPendingProposal({
        orgId,
        processKey,
        baseMapId,
        metrics,
        bottlenecks,
        citations,
        proposerId: j.id,
      });
      if (!proposal) {
        return {
          ok: false,
          stage: "redesign" as const,
          summary: "Redesigner produced no actionable changeset.",
        };
      }
      const redesignId = await insertPendingRedesign(supabase, proposal);
      return {
        ok: true,
        stage: "redesign" as const,
        artifactId: redesignId,
        redesignId,
        summary: out.result.summary,
      };
    },

    async runAutomate({
      orgId,
      redesignId,
    }: {
      orgId: string;
      redesignId: string;
    }) {
      // Hydrate the redesign row from the DB. The junior's payload
      // schema rejects non-executed redesigns, so we hand it the
      // post-approval shape.
      const redesign = await readRedesignRow(supabase, orgId, redesignId);
      if (!redesign) {
        return {
          ok: false,
          stage: "automate" as const,
          summary: "Redesign not found for automation.",
          error: "not_found",
        };
      }
      if (!redesign.executed) {
        return {
          ok: false,
          stage: "automate" as const,
          summary:
            "Redesign has not been executed (4-eye gate not passed). The automator requires an approved + executed redesign.",
          error: "redesign_not_executed",
        };
      }
      // C2 audit fix (iteration 16): TOCTOU defense — refuse to run
      // the automator if a DRAFT manifest already exists for this
      // redesign (retired / active / paused manifests are fine —
      // operators may legitimately want to re-draft after retiring
      // a prior version). Two concurrent runAutomate calls on the
      // same redesign would otherwise both pass the `executed=true`
      // check and produce duplicate draft manifests, which downstream
      // activation gates would treat as two distinct artifacts.
      //
      // The pre-flight is a best-effort gate that closes the easy
      // double-click race. The proper TOCTOU fix is a partial unique
      // index on `(redesign_id) WHERE status='draft'` at the DB layer
      // — flagged as a follow-up migration. Until that lands, this
      // pre-flight is the in-code defense.
      const existingDraftId = await readDraftManifestIdForRedesign(
        supabase,
        orgId,
        redesignId,
      );
      if (existingDraftId) {
        return {
          ok: false,
          stage: "automate" as const,
          artifactId: existingDraftId,
          manifestId: existingDraftId,
          summary: `A draft manifest already exists for this redesign (${existingDraftId}). Retire it before re-running automate.`,
          error: "manifest_already_drafted",
        };
      }
      const j = getJunior("process-automator");
      const out = await executor.run({
        junior: j,
        orgId,
        triggerKind: "manual",
        payload: { redesign, supabase },
      });
      if (out.result.outcome !== "ok") {
        return {
          ok: false,
          stage: "automate" as const,
          summary: out.result.summary,
          error: out.result.errorMessage,
        };
      }
      // The junior persists the manifest; we read back the latest
      // draft for this redesign so the caller can drive the activation
      // gate without an extra round-trip.
      const manifestId = await readLatestManifestIdForRedesign(
        supabase,
        orgId,
        redesignId,
      );
      return {
        ok: true,
        stage: "automate" as const,
        artifactId: manifestId,
        manifestId,
        summary: out.result.summary,
      };
    },

    async runVerify({
      orgId,
      manifestId,
      traceSampleSize,
    }: {
      orgId: string;
      manifestId: string;
      traceSampleSize?: number;
    }) {
      const manifest = await readManifestRow(supabase, orgId, manifestId);
      if (!manifest) {
        return {
          ok: false,
          stage: "verify" as const,
          summary: "Manifest not found for verification.",
          error: "not_found",
        };
      }
      if (manifest.status !== "draft") {
        return {
          ok: false,
          stage: "verify" as const,
          summary: `Manifest status is "${manifest.status}"; verifier only runs against drafts.`,
          error: "non_draft_manifest",
        };
      }
      // Pull the latest map for this process_key — supplies the
      // targetGraph + a sample of legacy traces. The verifier's
      // schema requires ≥ 1 trace.
      const sourceMap = await readLatestMapAndTraces(
        supabase,
        orgId,
        manifest.processKey,
        Math.max(1, Math.min(200, traceSampleSize ?? 50)),
      );
      if (!sourceMap || sourceMap.traces.length === 0) {
        return {
          ok: false,
          stage: "verify" as const,
          summary:
            "No legacy traces available for the source process_map; cannot run canary.",
          error: "no_legacy_traces",
        };
      }
      const j = getJunior("process-verifier");
      const out = await executor.run({
        junior: j,
        orgId,
        triggerKind: "manual",
        payload: {
          manifest,
          legacyTraces: sourceMap.traces,
          targetGraph: sourceMap.graph,
          supabase,
        },
      });
      if (out.result.outcome !== "ok") {
        return {
          ok: false,
          stage: "verify" as const,
          summary: out.result.summary,
          error: out.result.errorMessage,
        };
      }
      // Parse the verdict back out of the junior's summary so the
      // activation route can gate without a separate canary read.
      // Junior format: "… → verdict: READY." / "REVIEW." / "BLOCK."
      //
      // H1+H2 audit fix (iteration 16): the previous regex
      // `/verdict:\s*(READY|REVIEW|BLOCK)\./` was unanchored and
      // defaulted to permissive REVIEW on unmatched input. Two
      // hardening moves:
      //   1. Anchor to end-of-string so a hostile junior summary
      //      containing multiple "verdict: X." markers (or where a
      //      processKey echo happens to contain the literal) can't
      //      mislead the activation gate.
      //   2. Default to BLOCK (fail closed) instead of REVIEW so a
      //      junior that omits the verdict — or whose summary shape
      //      changes in a future refactor — is treated as untrusted
      //      rather than auto-promoted to operator-override-required.
      //      The activation route refuses BLOCK even on operator
      //      click; REVIEW would have allowed clickthrough.
      const verdictMatch = /verdict:\s*(READY|REVIEW|BLOCK)\.\s*$/.exec(
        out.result.summary.trim(),
      );
      const verdict =
        (verdictMatch?.[1] as VerifierVerdict | undefined) ?? "BLOCK";
      return {
        ok: true,
        stage: "verify" as const,
        artifactId: manifest.id,
        verdict,
        tracesReplayed: sourceMap.traces.length,
        summary: out.result.summary,
      };
    },
  });
  return coordinator;
}

// ---------------------------------------------------------------------------
// Supabase helpers (loose-shape, deliberate)
// ---------------------------------------------------------------------------

async function readLatestMapId(
  supabase: PipelineSupabaseLike,
  orgId: string,
  processKey: string,
): Promise<string | undefined> {
  try {
    const r = await supabase
      .from("process_maps")
      .select("id")
      .eq("org_id", orgId)
      .eq("process_key", processKey)
      .order("version", { ascending: false })
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (Array.isArray(data) && data[0]) {
      return String((data[0] as { id?: unknown }).id ?? "") || undefined;
    }
  } catch (e) {
    // M3 audit fix: surface caught supabase errors so an RLS denial or
    // outage isn't silently misread as "no map exists".
    log.warn("md.process-mining.readLatestMapId.read-failed", {
      orgId,
      processKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return undefined;
}

async function readMapRow(
  supabase: PipelineSupabaseLike,
  orgId: string,
  mapId: string,
): Promise<{
  graph: import("./types").ProcessMapGraph;
  metrics: ProcessMapMetrics;
} | null> {
  try {
    const r = await supabase
      .from("process_maps")
      .select("graph, metrics")
      .eq("org_id", orgId)
      .eq("id", mapId)
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (!Array.isArray(data) || !data[0]) return null;
    const row = data[0] as { graph?: unknown; metrics?: unknown };
    if (!row.graph || !row.metrics) return null;
    return {
      graph: row.graph as import("./types").ProcessMapGraph,
      metrics: row.metrics as ProcessMapMetrics,
    };
  } catch (e) {
    log.warn("md.process-mining.readMapRow.read-failed", {
      orgId,
      mapId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function insertPendingRedesign(
  supabase: PipelineSupabaseLike,
  proposal: RedesignProposalInput,
): Promise<string | undefined> {
  try {
    const ins = await supabase.from("process_redesigns").insert([
      {
        org_id: proposal.orgId,
        process_key: proposal.processKey,
        base_map_id: proposal.baseMapId,
        proposer_kind: proposal.proposerKind,
        proposer_id: proposal.proposerId,
        changeset: proposal.changeset,
        expected_impact: proposal.expectedImpact,
        citations: proposal.citations ?? null,
        rationale: proposal.rationale,
      },
    ]);
    const data = (ins as { data?: ReadonlyArray<{ id?: unknown }> }).data;
    return Array.isArray(data) && data[0]
      ? String(data[0].id ?? "") || undefined
      : undefined;
  } catch (e) {
    log.warn("md.process-mining.insertPendingRedesign.insert-failed", {
      orgId: proposal.orgId,
      processKey: proposal.processKey,
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }
}

async function collectCitations(
  processKey: string,
  bottlenecks: ReadonlyArray<Bottleneck>,
  fetcher: (query: string) => Promise<ReadonlyArray<Citation>>,
): Promise<ReadonlyArray<Citation>> {
  const out: Citation[] = [];
  for (const b of bottlenecks) {
    const query = `improve ${processKey.replace(/_/g, " ")} ${b.kind.replace("_", " ")} best practices`;
    try {
      const cits = await fetcher(query);
      for (const c of cits) out.push(c);
    } catch (e) {
      log.warn("md.process-mining.collectCitations.fetch-failed", {
        query,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return Object.freeze(out);
}

function buildPendingProposal(input: {
  readonly orgId: string;
  readonly processKey: string;
  readonly baseMapId: string;
  readonly metrics: ProcessMapMetrics;
  readonly bottlenecks: ReadonlyArray<Bottleneck>;
  readonly citations?: ReadonlyArray<Citation>;
  readonly proposerId: string;
}): RedesignProposalInput | null {
  // M-2: top-level ESM import (was require()) — the proposer doesn't
  // re-import the coordinator, so there's no circular dep.
  return proposeRedesign({
    orgId: input.orgId,
    processKey: input.processKey,
    baseMapId: input.baseMapId,
    metrics: input.metrics,
    bottlenecks: input.bottlenecks,
    proposerId: input.proposerId,
    citations: input.citations,
  });
}

// ---------------------------------------------------------------------------
// Stage 7-9 reader helpers (Phase-2(f) wiring).
//
// All helpers are tenant-scoped (filter by org_id) so a future bug
// passing a cross-org id can't fold another tenant's redesign /
// manifest / map into this org's automation pipeline. Same defense
// pattern as memory-v2 M-CT1 / consolidation.ts.
// ---------------------------------------------------------------------------

async function readRedesignRow(
  supabase: PipelineSupabaseLike,
  orgId: string,
  redesignId: string,
): Promise<ProcessRedesignRecord | null> {
  try {
    const r = await supabase
      .from("process_redesigns")
      .select("*")
      .eq("id", redesignId)
      .eq("org_id", orgId)
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (!Array.isArray(data) || !data[0]) return null;
    return mapRedesignRow(data[0] as Record<string, unknown>);
  } catch (e) {
    log.warn("md.process-mining.readRedesignRow.read-failed", {
      orgId,
      redesignId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Snake-case → camel-case mapper for `process_redesigns` rows.
 *
 * C1 audit fix (iteration 16): the previous `data[0] as ProcessRedesignRecord`
 * cast silently produced an object where `processKey` / `redesignId` /
 * `baseMapId` / `executedAt` / etc. were ALL undefined (the row has
 * `process_key`, `redesign_id`, `base_map_id`, `executed_at` per the
 * snake_case Postgres convention). Downstream consumers (the automator
 * junior's payload schema, manifest inserts) saw `processKey:
 * undefined` and silently wrote NULL/garbage. The TS cast was a lie.
 *
 * Returns `null` when the row is missing essential identity fields
 * (id + org_id + process_key + changeset) so the caller can return
 * not_found cleanly. All other fields default to safe values rather
 * than undefined.
 */
function mapRedesignRow(
  row: Record<string, unknown>,
): ProcessRedesignRecord | null {
  if (
    typeof row.id !== "string" ||
    typeof row.org_id !== "string" ||
    typeof row.process_key !== "string" ||
    !Array.isArray(row.changeset)
  ) {
    return null;
  }
  return {
    id: row.id,
    orgId: row.org_id,
    processKey: row.process_key,
    baseMapId: typeof row.base_map_id === "string" ? row.base_map_id : "",
    proposerKind:
      typeof row.proposer_kind === "string"
        ? (row.proposer_kind as ProcessRedesignRecord["proposerKind"])
        : "junior",
    proposerId: typeof row.proposer_id === "string" ? row.proposer_id : "",
    changeset: row.changeset as ProcessRedesignRecord["changeset"],
    expectedImpact:
      typeof row.expected_impact === "object" && row.expected_impact !== null
        ? (row.expected_impact as ProcessRedesignRecord["expectedImpact"])
        : { cycleTimeSavingPct: 0, risks: [] },
    rationale: typeof row.rationale === "string" ? row.rationale : "",
    citations: Array.isArray(row.citations)
      ? (row.citations as ProcessRedesignRecord["citations"])
      : undefined,
    status: (typeof row.status === "string"
      ? row.status
      : "pending") as ProcessRedesignRecord["status"],
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
    approvedBy: typeof row.approved_by === "string" ? row.approved_by : null,
    rejectedAt: typeof row.rejected_at === "string" ? row.rejected_at : null,
    rejectedBy: typeof row.rejected_by === "string" ? row.rejected_by : null,
    rejectReason:
      typeof row.reject_reason === "string" ? row.reject_reason : null,
    executed: row.executed === true,
    executedAt: typeof row.executed_at === "string" ? row.executed_at : null,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
  };
}

/**
 * Snake-case → camel-case mapper for `automation_manifests` rows.
 *
 * C1 audit fix (iteration 16): same root cause as `mapRedesignRow` —
 * the cast lied. Now we explicitly map every column and validate the
 * required identity fields. Returns null on missing essentials.
 */
function mapManifestRow(
  row: Record<string, unknown>,
): AutomationManifestRecord | null {
  if (
    typeof row.id !== "string" ||
    typeof row.org_id !== "string" ||
    typeof row.process_key !== "string" ||
    typeof row.redesign_id !== "string"
  ) {
    return null;
  }
  // The `manifest` jsonb column is the structured `{ steps: [...] }`
  // payload. Accept either a properly-shaped object or fall back to
  // an empty step list so the verifier's targetGraph + stepTargets
  // computation doesn't crash on a partial migration.
  const rawManifest = row.manifest;
  const manifestPayload =
    typeof rawManifest === "object" &&
    rawManifest !== null &&
    Array.isArray((rawManifest as { steps?: unknown }).steps)
      ? (rawManifest as AutomationManifestRecord["manifest"])
      : { steps: [] };
  return {
    id: row.id,
    orgId: row.org_id,
    processKey: row.process_key,
    redesignId: row.redesign_id,
    manifest: manifestPayload,
    riskTier: (typeof row.risk_tier === "string"
      ? row.risk_tier
      : "low") as AutomationManifestRecord["riskTier"],
    status: (typeof row.status === "string"
      ? row.status
      : "draft") as AutomationManifestRecord["status"],
    activatedAt: typeof row.activated_at === "string" ? row.activated_at : null,
    activatedBy: typeof row.activated_by === "string" ? row.activated_by : null,
    pausedAt: typeof row.paused_at === "string" ? row.paused_at : null,
    pausedBy: typeof row.paused_by === "string" ? row.paused_by : null,
    retiredAt: typeof row.retired_at === "string" ? row.retired_at : null,
    retiredBy: typeof row.retired_by === "string" ? row.retired_by : null,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
  };
}

async function readLatestManifestIdForRedesign(
  supabase: PipelineSupabaseLike,
  orgId: string,
  redesignId: string,
): Promise<string | undefined> {
  try {
    const r = await supabase
      .from("automation_manifests")
      .select("id")
      .eq("org_id", orgId)
      .eq("redesign_id", redesignId)
      .order("created_at", { ascending: false })
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (Array.isArray(data) && data[0]) {
      return String((data[0] as { id?: unknown }).id ?? "") || undefined;
    }
  } catch (e) {
    log.warn("md.process-mining.readLatestManifestIdForRedesign.read-failed", {
      orgId,
      redesignId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return undefined;
}

/**
 * C2 audit fix helper: returns the id of an EXISTING DRAFT manifest
 * for this redesign, or `undefined` if none exists. Used by
 * `runAutomate` to refuse re-running when a draft is already pending
 * (operators must retire the existing draft before re-drafting).
 *
 * Tenant-scoped by org_id — same defense pattern as the other
 * coordinator readers.
 */
async function readDraftManifestIdForRedesign(
  supabase: PipelineSupabaseLike,
  orgId: string,
  redesignId: string,
): Promise<string | undefined> {
  try {
    const r = await supabase
      .from("automation_manifests")
      .select("id")
      .eq("org_id", orgId)
      .eq("redesign_id", redesignId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (Array.isArray(data) && data[0]) {
      return String((data[0] as { id?: unknown }).id ?? "") || undefined;
    }
  } catch (e) {
    log.warn("md.process-mining.readDraftManifestIdForRedesign.read-failed", {
      orgId,
      redesignId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return undefined;
}

async function readManifestRow(
  supabase: PipelineSupabaseLike,
  orgId: string,
  manifestId: string,
): Promise<AutomationManifestRecord | null> {
  try {
    const r = await supabase
      .from("automation_manifests")
      .select("*")
      .eq("id", manifestId)
      .eq("org_id", orgId)
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (!Array.isArray(data) || !data[0]) return null;
    return mapManifestRow(data[0] as Record<string, unknown>);
  } catch (e) {
    log.warn("md.process-mining.readManifestRow.read-failed", {
      orgId,
      manifestId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Pull the latest `process_maps` row for a process_key plus the most
 * recent N traces from `process_events`. The verifier replays the
 * traces against the manifest steps.
 *
 * Returns `null` when the map is missing entirely. An empty trace
 * array is still returned so the caller can produce a stage-specific
 * "no_legacy_traces" error rather than silently no-op.
 */
async function readLatestMapAndTraces(
  supabase: PipelineSupabaseLike,
  orgId: string,
  processKey: string,
  sampleSize: number,
): Promise<{
  graph: import("./types").ProcessMapGraph;
  traces: ReadonlyArray<{ caseId: string; sequence: ReadonlyArray<string> }>;
} | null> {
  // Map first — supplies the targetGraph.
  let graph: import("./types").ProcessMapGraph | null = null;
  try {
    const r = await supabase
      .from("process_maps")
      .select("graph")
      .eq("org_id", orgId)
      .eq("process_key", processKey)
      .order("version", { ascending: false })
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    const row =
      Array.isArray(data) && data[0] ? (data[0] as { graph?: unknown }) : null;
    graph =
      (row?.graph as import("./types").ProcessMapGraph | undefined) ?? null;
  } catch {
    /* fall through to null */
  }
  if (!graph) return null;

  // Traces: latest N events grouped by case_id. The schema stores
  // one row per activity firing; we group + order client-side because
  // ProcessMaps store events shape-by-shape.
  let rows: ReadonlyArray<{
    case_id?: string;
    activity?: string;
    occurred_at?: string;
  }> = [];
  try {
    const r = await supabase
      .from("process_events")
      .select("case_id, activity, occurred_at")
      .eq("org_id", orgId)
      .eq("process_key", processKey)
      .order("occurred_at", { ascending: false })
      .limit(sampleSize * 32); // assume ≤ 32 activities per case
    rows = ((r as { data?: unknown[] }).data ?? []) as ReadonlyArray<{
      case_id?: string;
      activity?: string;
      occurred_at?: string;
    }>;
  } catch {
    return { graph, traces: [] };
  }
  // Group into traces by caseId, sort each by occurred_at ascending.
  const grouped = new Map<
    string,
    Array<{ activity: string; occurred_at: string }>
  >();
  for (const r of rows) {
    if (!r.case_id || !r.activity || !r.occurred_at) continue;
    const arr = grouped.get(r.case_id) ?? [];
    arr.push({ activity: r.activity, occurred_at: r.occurred_at });
    grouped.set(r.case_id, arr);
  }
  const traces: Array<{ caseId: string; sequence: ReadonlyArray<string> }> = [];
  // Most-recently-active case first → traces array is "freshest" cases.
  const sortedCaseIds = Array.from(grouped.entries())
    .sort((a, b) => {
      const aLatest =
        a[1]
          .map((e) => e.occurred_at)
          .sort()
          .pop() ?? "";
      const bLatest =
        b[1]
          .map((e) => e.occurred_at)
          .sort()
          .pop() ?? "";
      return bLatest.localeCompare(aLatest);
    })
    .slice(0, sampleSize)
    .map(([id]) => id);
  for (const caseId of sortedCaseIds) {
    const events = grouped.get(caseId) ?? [];
    const sequence = events
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      .map((e) => e.activity);
    if (sequence.length > 0) traces.push({ caseId, sequence });
  }
  // M2 audit fix: log when the trace-fetch limit `sampleSize * 32`
  // probably truncated the most-recent traces (we asked for N cases
  // but came back with < N). Could mean (a) the process genuinely
  // doesn't have N completed cases yet — fine — OR (b) some cases
  // have > 32 activities and the LIMIT cut us off mid-case — which
  // distorts the canary result. Either way the operator should know.
  if (traces.length < sampleSize) {
    log.warn("md.process-mining.readLatestMapAndTraces.trace-undersampled", {
      orgId,
      processKey,
      requested: sampleSize,
      actual: traces.length,
    });
  }
  return { graph, traces };
}
