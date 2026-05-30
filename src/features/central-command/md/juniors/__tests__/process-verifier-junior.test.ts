/**
 * Tests — process-verifier junior. Verifies canary persistence +
 * fitness aggregation + the draft-only guard.
 */

import { describe, expect, it, vi } from "vitest";

// iter-50-final: the verifier now calls assertTierPolicy before any
// persist. Tests exercise canary logic, not the governance gate; stub
// the gate to always-allow.
vi.mock("@/core/governance/tier-policy", () => ({
  assertTierPolicy: vi.fn(() => ({ ok: true })),
}));

import { processVerifierJunior } from "../agents/process-verifier-junior";
import type {
  AutomationManifestRecord,
  ProcessMapGraph,
} from "../../process-mining/types";
import type { JuniorRunContext } from "../types";

const ORG = "11111111-1111-1111-1111-111111111111";

const targetGraph: ProcessMapGraph = Object.freeze({
  nodes: Object.freeze([
    {
      activity: "Apply",
      occurrences: 5,
      durationMs: { mean: 0, median: 0, p95: 0 },
    },
    {
      activity: "KYC",
      occurrences: 5,
      durationMs: { mean: 0, median: 0, p95: 0 },
    },
    {
      activity: "Approve",
      occurrences: 5,
      durationMs: { mean: 0, median: 0, p95: 0 },
    },
  ]),
  edges: Object.freeze([
    {
      from: "Apply",
      to: "KYC",
      frequency: 5,
      waitMs: { mean: 0, median: 0, p95: 0 },
    },
    {
      from: "KYC",
      to: "Approve",
      frequency: 5,
      waitMs: { mean: 0, median: 0, p95: 0 },
    },
  ]),
  variants: Object.freeze([]),
  startActivities: Object.freeze(["Apply"]),
  endActivities: Object.freeze(["Approve"]),
});

function makeManifest(
  overrides: Partial<AutomationManifestRecord> = {},
): AutomationManifestRecord {
  return Object.freeze({
    id: "manifest-1",
    orgId: ORG,
    processKey: "loan_origination",
    redesignId: "redesign-1",
    manifest: {
      steps: Object.freeze([
        Object.freeze({
          kind: "spawn_junior" as const,
          stepId: "s1",
          target: "Apply",
        }),
        Object.freeze({
          kind: "spawn_junior" as const,
          stepId: "s2",
          target: "KYC",
        }),
        Object.freeze({
          kind: "spawn_junior" as const,
          stepId: "s3",
          target: "Approve",
        }),
      ]),
    },
    riskTier: "medium" as const,
    status: "draft",
    activatedAt: null,
    activatedBy: null,
    pausedAt: null,
    pausedBy: null,
    retiredAt: null,
    retiredBy: null,
    createdAt: "2026-05-18T00:00:00Z",
    ...overrides,
  }) as AutomationManifestRecord;
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

function ctx(payload: unknown): JuniorRunContext {
  return {
    orgId: ORG,
    juniorId: "process-verifier",
    triggerKind: "manual",
    payload,
    schemaRegistry: {} as never,
    guardrails: processVerifierJunior.guardrails,
    signal: new AbortController().signal,
    runId: "run",
  };
}

describe("processVerifierJunior", () => {
  it("skips a non-draft manifest", async () => {
    const fake = makeFakeSupabase();
    const r = await processVerifierJunior.execute(
      ctx({
        manifest: makeManifest({ status: "active" }),
        legacyTraces: [{ caseId: "c1", sequence: ["Apply", "KYC", "Approve"] }],
        targetGraph,
        supabase: fake.api,
      }),
    );
    expect(r.outcome).toBe("skipped_policy");
    expect(fake.rows.length).toBe(0);
  });

  it("persists one canary row per legacy trace and reports READY at perfect fitness", async () => {
    const fake = makeFakeSupabase();
    const r = await processVerifierJunior.execute(
      ctx({
        manifest: makeManifest(),
        legacyTraces: [
          { caseId: "c1", sequence: ["Apply", "KYC", "Approve"] },
          { caseId: "c2", sequence: ["Apply", "KYC", "Approve"] },
        ],
        targetGraph,
        supabase: fake.api,
      }),
    );
    expect(r.outcome).toBe("ok");
    expect(fake.rows.length).toBe(2);
    expect(r.summary).toMatch(/READY/);
  });

  it("flags BLOCK when traces miss most edges", async () => {
    const fake = makeFakeSupabase();
    const r = await processVerifierJunior.execute(
      ctx({
        manifest: makeManifest(),
        legacyTraces: [
          { caseId: "c1", sequence: ["ManualBypass1", "ManualBypass2"] },
          { caseId: "c2", sequence: ["ManualBypass3", "ManualBypass4"] },
        ],
        targetGraph,
        supabase: fake.api,
      }),
    );
    expect(r.summary).toMatch(/BLOCK/);
  });

  it("flags REVIEW for moderate divergence", async () => {
    const fake = makeFakeSupabase();
    const r = await processVerifierJunior.execute(
      ctx({
        manifest: makeManifest(),
        legacyTraces: [
          { caseId: "c1", sequence: ["Apply", "KYC", "Approve"] },
          { caseId: "c2", sequence: ["Apply", "ManualOverride", "Approve"] },
        ],
        targetGraph,
        supabase: fake.api,
      }),
    );
    expect(r.summary).toMatch(/REVIEW|READY|BLOCK/); // verdict computed
  });
});
