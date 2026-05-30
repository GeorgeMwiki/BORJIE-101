/**
 * Phase-2(f) wiring regression locks for the process-pipeline
 * coordinator's automator + verifier stages.
 *
 * Locks the contract:
 *   - runAutomate fetches the redesign row scoped by (id, org_id),
 *     refuses non-executed redesigns, hands the row to the
 *     "process-automator" junior, returns the freshest manifest id.
 *   - runVerify fetches the manifest row scoped by (id, org_id),
 *     refuses non-draft manifests, pulls legacy traces from
 *     process_events, hands them + the targetGraph to the
 *     "process-verifier" junior, parses the verdict out of the
 *     junior's summary string.
 *   - Both stages return tenant-scoped failures (`not_found`,
 *     `redesign_not_executed`, `non_draft_manifest`, `no_legacy_traces`)
 *     without ever calling the junior — defense in depth so a
 *     misconfigured caller can't bypass the gates.
 *
 * @module features/central-command/md/process-mining/__tests__/pipeline-coordinator-automate-verify
 */

import { describe, expect, it, vi } from "vitest";
import { makePipelineCoordinator } from "../pipeline-coordinator";
import type {
  JuniorExecutor,
  JuniorRegistry,
  MdJuniorPort,
} from "../../juniors";
import type { PipelineSupabaseLike } from "../pipeline-coordinator";

// ──────────────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────────────

function makeStubJunior(id: string, summary: string): MdJuniorPort {
  return Object.freeze({
    id,
    label: `stub:${id}`,
    domain: "ops",
    trigger: { kind: "manual", invokedBy: "test" },
    guardrails: {
      maxRowsPerRun: 0,
      maxProposalsPerRun: 0,
      cooldownMs: 0,
      maxDurationMs: 1000,
      allowedTables: [],
    },
    payloadSchema: {
      safeParse: () => ({ success: true, data: {} }),
    } as unknown as MdJuniorPort["payloadSchema"],
    description: "stub",
    execute: async () => ({
      outcome: "ok",
      proposalsFiled: 0,
      rowsProcessed: 1,
      summary,
    }),
  }) as MdJuniorPort;
}

function makeRegistry(juniors: ReadonlyArray<MdJuniorPort>): JuniorRegistry {
  const byId = new Map(juniors.map((j) => [j.id, j]));
  return {
    get: (id: string) => byId.get(id),
    list: () => juniors,
  } as JuniorRegistry;
}

function makeExecutor(
  override?: (id: string) => {
    outcome: string;
    summary: string;
    errorMessage?: string;
  },
): JuniorExecutor {
  return {
    run: async ({ junior }) => {
      const o =
        override?.(junior.id) ??
        ((await junior.execute({
          orgId: "org-1",
          payload: {},
          triggerKind: "manual",
          startedAt: new Date(),
        } as unknown as Parameters<MdJuniorPort["execute"]>[0])) as unknown as {
          outcome: string;
          summary: string;
          errorMessage?: string;
        });
      return {
        accepted: true,
        result: {
          outcome: o.outcome ?? "ok",
          proposalsFiled: 0,
          rowsProcessed: 1,
          summary: o.summary ?? "",
          errorMessage: o.errorMessage,
        },
        durationMs: 1,
        rowsProcessed: 1,
      } as unknown as Awaited<ReturnType<JuniorExecutor["run"]>>;
    },
  };
}

/**
 * Tiny supabase-shape stub. Captures inserts + answers known
 * select queries based on the test's `state` map.
 */
function makeSupabase(
  state: Record<string, ReadonlyArray<Record<string, unknown>>>,
): PipelineSupabaseLike {
  return {
    from(table: string) {
      const rows = state[table] ?? [];
      const chain = {
        _rows: rows as Array<Record<string, unknown>>,
        _filters: [] as Array<(r: Record<string, unknown>) => boolean>,
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          chain._filters.push((r) => r[col] === val);
          return chain;
        },
        order() {
          return chain;
        },
        is() {
          return chain;
        },
        limit() {
          const filtered = chain._rows.filter((r) =>
            chain._filters.every((f) => f(r)),
          );
          return Promise.resolve({ data: filtered, error: null });
        },
        insert: (newRows: ReadonlyArray<Record<string, unknown>>) => {
          chain._rows.push(...newRows);
          return Promise.resolve({ data: newRows, error: null });
        },
      };
      return chain as unknown as ReturnType<PipelineSupabaseLike["from"]>;
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// runAutomate
// ──────────────────────────────────────────────────────────────────

describe("pipeline-coordinator — Phase-2(f) runAutomate", () => {
  it("returns not_found when the redesign id does not exist", async () => {
    const coord = makePipelineCoordinator({
      executor: makeExecutor(),
      registry: makeRegistry([makeStubJunior("process-automator", "ok")]),
      supabase: makeSupabase({ process_redesigns: [] }),
    });
    const r = await coord.runAutomate({
      orgId: "org-1",
      redesignId: "missing",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_found");
  });

  it("refuses non-executed redesigns with `redesign_not_executed`", async () => {
    const coord = makePipelineCoordinator({
      executor: makeExecutor(),
      registry: makeRegistry([makeStubJunior("process-automator", "ok")]),
      supabase: makeSupabase({
        // C1 audit fix: use snake_case columns (real Postgres shape).
        process_redesigns: [
          {
            id: "r1",
            org_id: "org-1",
            process_key: "loan_origination",
            changeset: [],
            executed: false,
          },
        ],
      }),
    });
    const r = await coord.runAutomate({ orgId: "org-1", redesignId: "r1" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("redesign_not_executed");
  });

  it("hands the executed redesign to the automator and returns manifest id (legacy active manifest exists, NOT a draft)", async () => {
    // C2 audit fix (iteration 16): C2 refuses re-running automate when
    // a DRAFT manifest already exists for the redesign. The legacy
    // happy-path test pre-seeded a status-less manifest which is now
    // treated as a draft by the mapper's fallback. Pre-seed with
    // status='active' so the C2 pre-flight passes, and the readback
    // returns this existing manifest (since the stub junior doesn't
    // insert via supabase in tests).
    const supabase = makeSupabase({
      process_redesigns: [
        {
          id: "r1",
          org_id: "org-1",
          process_key: "loan_origination",
          changeset: [],
          executed: true,
        },
      ],
      automation_manifests: [
        {
          id: "m1",
          org_id: "org-1",
          redesign_id: "r1",
          process_key: "loan_origination",
          status: "active",
          manifest: { steps: [] },
        },
      ],
    });
    const coord = makePipelineCoordinator({
      executor: makeExecutor(() => ({ outcome: "ok", summary: "drafted" })),
      registry: makeRegistry([makeStubJunior("process-automator", "drafted")]),
      supabase,
    });
    const r = await coord.runAutomate({ orgId: "org-1", redesignId: "r1" });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe("automate");
    expect(r.manifestId).toBe("m1");
  });

  it("C2 audit: refuses re-run when a draft manifest already exists for the redesign", async () => {
    const supabase = makeSupabase({
      process_redesigns: [
        {
          id: "r1",
          org_id: "org-1",
          process_key: "loan_origination",
          changeset: [],
          executed: true,
        },
      ],
      automation_manifests: [
        {
          id: "existing-draft",
          org_id: "org-1",
          redesign_id: "r1",
          process_key: "loan_origination",
          status: "draft",
          manifest: { steps: [] },
        },
      ],
    });
    const coord = makePipelineCoordinator({
      executor: makeExecutor(() => ({ outcome: "ok", summary: "drafted" })),
      registry: makeRegistry([makeStubJunior("process-automator", "drafted")]),
      supabase,
    });
    const r = await coord.runAutomate({ orgId: "org-1", redesignId: "r1" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("manifest_already_drafted");
    expect(r.manifestId).toBe("existing-draft");
  });
});

// ──────────────────────────────────────────────────────────────────
// runVerify
// ──────────────────────────────────────────────────────────────────

describe("pipeline-coordinator — Phase-2(f) runVerify", () => {
  it("returns not_found when the manifest id does not exist", async () => {
    const coord = makePipelineCoordinator({
      executor: makeExecutor(),
      registry: makeRegistry([makeStubJunior("process-verifier", "ok")]),
      supabase: makeSupabase({ automation_manifests: [] }),
    });
    const r = await coord.runVerify({ orgId: "org-1", manifestId: "missing" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_found");
  });

  it("refuses non-draft manifests with `non_draft_manifest`", async () => {
    const coord = makePipelineCoordinator({
      executor: makeExecutor(),
      registry: makeRegistry([makeStubJunior("process-verifier", "ok")]),
      supabase: makeSupabase({
        automation_manifests: [
          {
            id: "m1",
            org_id: "org-1",
            process_key: "loan_origination",
            redesign_id: "r1",
            status: "active",
            manifest: { steps: [] },
          },
        ],
      }),
    });
    const r = await coord.runVerify({ orgId: "org-1", manifestId: "m1" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("non_draft_manifest");
  });

  it("returns no_legacy_traces when the source map has no events", async () => {
    const coord = makePipelineCoordinator({
      executor: makeExecutor(),
      registry: makeRegistry([makeStubJunior("process-verifier", "ok")]),
      supabase: makeSupabase({
        automation_manifests: [
          {
            id: "m1",
            org_id: "org-1",
            process_key: "loan_origination",
            redesign_id: "r1",
            status: "draft",
            manifest: { steps: [] },
          },
        ],
        process_maps: [], // no map → no_legacy_traces
        process_events: [],
      }),
    });
    const r = await coord.runVerify({ orgId: "org-1", manifestId: "m1" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_legacy_traces");
  });

  it("parses the verdict from the junior's summary and returns READY", async () => {
    const coord = makePipelineCoordinator({
      executor: makeExecutor(() => ({
        outcome: "ok",
        summary:
          "Canary complete for manifest m1: aggregate fitness 95.0%, 2/2 traces persisted, 0 divergences → verdict: READY.",
      })),
      registry: makeRegistry([makeStubJunior("process-verifier", "ok")]),
      supabase: makeSupabase({
        automation_manifests: [
          {
            id: "m1",
            org_id: "org-1",
            process_key: "loan_origination",
            redesign_id: "r1",
            status: "draft",
            manifest: { steps: [{ target: "step-a" }] },
          },
        ],
        process_maps: [
          {
            id: "map-1",
            org_id: "org-1",
            process_key: "loan_origination",
            graph: { nodes: [], edges: [] },
          },
        ],
        process_events: [
          {
            org_id: "org-1",
            process_key: "loan_origination",
            case_id: "c1",
            activity: "step-a",
            occurred_at: "2026-05-01T00:00:00.000Z",
          },
        ],
      }),
    });
    const r = await coord.runVerify({ orgId: "org-1", manifestId: "m1" });
    expect(r.ok).toBe(true);
    expect(r.verdict).toBe("READY");
    expect(r.tracesReplayed).toBe(1);
  });

  it("H1+H2 audit: falls back to BLOCK (fail-closed) when the junior's summary lacks an end-anchored verdict marker", async () => {
    const coord = makePipelineCoordinator({
      executor: makeExecutor(() => ({
        outcome: "ok",
        summary: "Canary completed (no verdict in summary).",
      })),
      registry: makeRegistry([makeStubJunior("process-verifier", "ok")]),
      supabase: makeSupabase({
        automation_manifests: [
          {
            id: "m1",
            org_id: "org-1",
            process_key: "loan_origination",
            redesign_id: "r1",
            status: "draft",
            manifest: { steps: [{ target: "step-a" }] },
          },
        ],
        process_maps: [
          {
            id: "map-1",
            org_id: "org-1",
            process_key: "loan_origination",
            graph: { nodes: [], edges: [] },
          },
        ],
        process_events: [
          {
            org_id: "org-1",
            process_key: "loan_origination",
            case_id: "c1",
            activity: "step-a",
            occurred_at: "2026-05-01T00:00:00.000Z",
          },
        ],
      }),
    });
    const r = await coord.runVerify({ orgId: "org-1", manifestId: "m1" });
    expect(r.ok).toBe(true);
    expect(r.verdict).toBe("BLOCK");
  });
});

// Silence: TS expects vi import even when unused in some setups.
void vi;
