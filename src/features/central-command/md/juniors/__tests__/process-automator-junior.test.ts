/**
 * Tests — process-automator junior. Verifies the redesign -> manifest
 * mapping rules + risk-tier escalation + the post-approval guard.
 */

import { describe, expect, it, vi } from "vitest";

// iter-50-final: the automator now calls assertTierPolicy before any
// persist. Tests exercise the mapping/persistence logic, not the
// governance gate; stub the gate to always-allow.
vi.mock("@/core/governance/tier-policy", () => ({
  assertTierPolicy: vi.fn(() => ({ ok: true })),
}));

import {
  mapRedesignToSteps,
  processAutomatorJunior,
} from "../agents/process-automator-junior";
import type {
  ProcessRedesignRecord,
  RedesignChange,
} from "../../process-mining/types";
import type { JuniorRunContext } from "../types";

const ORG = "11111111-1111-1111-1111-111111111111";
const REDESIGN_ID = "22222222-2222-2222-2222-222222222222";
const BASE_MAP_ID = "33333333-3333-3333-3333-333333333333";

function redesign(
  changeset: ReadonlyArray<RedesignChange>,
  overrides: Partial<ProcessRedesignRecord> = {},
): ProcessRedesignRecord {
  return Object.freeze({
    id: REDESIGN_ID,
    orgId: ORG,
    processKey: "loan_origination",
    baseMapId: BASE_MAP_ID,
    proposerKind: "junior",
    proposerId: "process-redesigner",
    changeset,
    expectedImpact: { cycleTimeSavingPct: 12 },
    citations: [],
    rationale: "Test redesign.",
    status: "approved",
    approvedAt: "2026-05-18T00:00:00Z",
    approvedBy: "owner",
    rejectedAt: null,
    rejectedBy: null,
    rejectReason: null,
    executed: true,
    executedAt: "2026-05-18T00:00:01Z",
    createdAt: "2026-05-17T00:00:00Z",
    ...overrides,
  }) as ProcessRedesignRecord;
}

describe("mapRedesignToSteps", () => {
  it("automate_activity emits spawn_junior + write_audit + bumps to medium", () => {
    const r = mapRedesignToSteps(
      redesign([
        {
          kind: "automate_activity",
          target: "Manual KYC review",
          description: "Auto-classify low-risk applicants.",
        },
      ]),
    );
    expect(r.steps.length).toBe(2);
    expect(r.steps[0]!.kind).toBe("spawn_junior");
    expect(r.steps[1]!.kind).toBe("write_audit");
    expect(r.riskTier).toBe("medium");
  });

  it("remove_activity escalates to high", () => {
    const r = mapRedesignToSteps(
      redesign([
        {
          kind: "remove_activity",
          target: "Paper checklist",
          description: "Drop redundant compliance step.",
        },
      ]),
    );
    expect(r.riskTier).toBe("high");
  });

  it("APR-mentioning risk surface escalates to high", () => {
    const r = mapRedesignToSteps(
      redesign(
        [
          {
            kind: "introduce_decision",
            target: "APR routing",
            description: "Split high-APR vs low.",
          },
        ],
        {
          expectedImpact: {
            cycleTimeSavingPct: 5,
            risks: ["Touches APR cap rules"],
          },
        },
      ),
    );
    expect(r.riskTier).toBe("high");
  });

  it("introduce_decision emits an evaluate_condition step", () => {
    const r = mapRedesignToSteps(
      redesign([
        {
          kind: "introduce_decision",
          target: "Risk gate",
          description: "Route by score.",
        },
      ]),
    );
    expect(r.steps[0]!.kind).toBe("evaluate_condition");
  });

  it("parallelise / reorder_edge map to schedule_action", () => {
    const r = mapRedesignToSteps(
      redesign([
        {
          kind: "parallelise",
          target: "A->B",
          description: "Run in parallel.",
        },
      ]),
    );
    expect(r.steps[0]!.kind).toBe("schedule_action");
  });

  it("consolidate_activities maps to write_audit", () => {
    const r = mapRedesignToSteps(
      redesign([
        {
          kind: "consolidate_activities",
          target: "QA1",
          description: "Fold into QA2.",
        },
      ]),
    );
    expect(r.steps[0]!.kind).toBe("write_audit");
  });
});

describe("processAutomatorJunior", () => {
  function makeCtx(payload: {
    redesign: ProcessRedesignRecord;
    supabase: unknown;
  }): JuniorRunContext {
    return {
      orgId: ORG,
      juniorId: "process-automator",
      triggerKind: "manual",
      payload,
      schemaRegistry: {} as never,
      guardrails: processAutomatorJunior.guardrails,
      signal: new AbortController().signal,
      runId: "run",
    };
  }

  function makeFakeSupabase() {
    const rows: Array<Record<string, unknown>> = [];
    const api = {
      from(_t: string) {
        return {
          insert(input: unknown) {
            const incoming = Array.isArray(input) ? input : [input];
            for (const r of incoming) rows.push(r as Record<string, unknown>);
            return Promise.resolve({ data: incoming, error: null });
          },
        };
      },
    };
    return { api, rows };
  }

  it("skips when the redesign has not been executed yet", async () => {
    const fake = makeFakeSupabase();
    const r = await processAutomatorJunior.execute(
      makeCtx({
        redesign: redesign(
          [
            {
              kind: "automate_activity",
              target: "x",
              description: "y",
            },
          ],
          { executed: false },
        ),
        supabase: fake.api,
      }),
    );
    expect(r.outcome).toBe("skipped_policy");
    expect(fake.rows.length).toBe(0);
  });

  it("persists a draft manifest with risk_tier derived from mapping", async () => {
    const fake = makeFakeSupabase();
    const r = await processAutomatorJunior.execute(
      makeCtx({
        redesign: redesign([
          {
            kind: "automate_activity",
            target: "Manual KYC",
            description: "Auto-classify low-risk.",
          },
        ]),
        supabase: fake.api,
      }),
    );
    expect(r.outcome).toBe("ok");
    expect(fake.rows.length).toBe(1);
    expect(fake.rows[0]!.status).toBe("draft");
    expect(fake.rows[0]!.risk_tier).toBe("medium");
  });

  it("emits zero steps + ok-outcome on empty changeset", async () => {
    const fake = makeFakeSupabase();
    const r = await processAutomatorJunior.execute(
      makeCtx({ redesign: redesign([]), supabase: fake.api }),
    );
    expect(r.outcome).toBe("ok");
    expect(r.rowsProcessed).toBe(0);
    expect(fake.rows.length).toBe(0);
  });
});
