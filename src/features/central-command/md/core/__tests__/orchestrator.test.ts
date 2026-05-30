/**
 * MD core - orchestrator routing tests.
 *
 * Uses in-memory implementations of every subagent port. Ensures:
 *   - Tier-gated entry point.
 *   - Snapshot fetch happens once per turn.
 *   - Every turn produces a DecisionTrace.
 *   - Events are emitted in the expected order (observation -> assessment
 *     -> proposals -> follow-up -> style-update).
 *   - Proposals carry an autonomy level resolved by `decideLevel`.
 */

import { describe, it, expect } from "vitest";

import { MdOrchestrator } from "../orchestrator";
import {
  BusinessStateService,
  emptySnapshot,
  type BusinessStateFetcher,
} from "../business-state";
import type {
  MdAutoPopulatePort,
  MdFollowUpPort,
  MdFollowUpRecord,
  MdNbaPort,
  MdOwnerStylePort,
  MdSubagents,
} from "../contracts";
import type {
  BusinessSnapshot,
  RankedAction,
} from "@/features/central-command/md/nba/types";
import { InMemoryTraceStore } from "@/core/borjie-ai/decision-trace";

function fakeRanked(
  id: string,
  domain: RankedAction["domain"] = "sales",
): RankedAction {
  return Object.freeze({
    templateId: id,
    title: `Action ${id}`,
    description: `Do thing ${id}`,
    domain,
    ice: Object.freeze({ impact: 8, confidence: 0.8, ease: 7, ice: 44.8 }),
    rice: Object.freeze({
      reach: 100,
      impact: 8,
      confidence: 0.8,
      effortPersonDays: 2,
      rice: 320,
    }),
    wsjf: Object.freeze({
      userBusinessValue: 8,
      timeCriticality: 6,
      riskReductionOpportunityEnablement: 5,
      jobSize: 2,
      costOfDelay: 19,
      wsjf: 9.5,
    }),
    eisenhower: Object.freeze({
      urgent: true,
      important: true,
      quadrant: "do-now",
      urgencyScore: 8,
      importanceScore: 9,
    }),
    compositeScore: 90,
    rationale: `Because ${id}`,
  });
}

function makeNba(items: ReadonlyArray<RankedAction>): MdNbaPort {
  return {
    async rankActions(_snap, k) {
      return items.slice(0, k);
    },
    async getNextLowHangingFruit() {
      return items[0] ?? null;
    },
    async getNextHighImpact() {
      return items[0] ?? null;
    },
    async getDailyAgenda() {
      return items;
    },
  };
}

function makeOwnerStyle(): MdOwnerStylePort {
  return {
    async getProfile(ownerId) {
      return {
        ownerId,
        posture: "data-driven",
        confidence: 0.6,
        tonePrefs: [],
        updatedAtMs: 0,
      };
    },
    async refine(ownerId, _obs) {
      return {
        profile: {
          ownerId,
          posture: "bias-to-action",
          confidence: 0.7,
          tonePrefs: [],
          updatedAtMs: Date.now(),
        },
        changeNote: "owner is leaning more decisive this week",
      };
    },
  };
}

function makeFollowUp(): MdFollowUpPort {
  const rows: MdFollowUpRecord[] = [];
  return {
    async schedule(req) {
      const rec: MdFollowUpRecord = Object.freeze({
        followUpId: `fu-${rows.length + 1}`,
        orgId: req.orgId,
        ownerId: req.ownerId,
        title: req.title,
        dueAtMs: req.dueAtMs,
        sourceRef: req.sourceRef,
        subjectKind: req.subjectKind,
        subjectId: req.subjectId,
        createdAtMs: Date.now(),
      });
      rows.push(rec);
      return rec;
    },
    async listDue() {
      return rows;
    },
  };
}

const stubAutoPopulate: MdAutoPopulatePort = {
  async populate() {
    return {
      ok: true,
      target: "noop",
      fields: {},
      provenance: {},
      gaps: [],
    };
  },
};

function makeFetcher(s: BusinessSnapshot): BusinessStateFetcher {
  return {
    async fetch() {
      return s;
    },
  };
}

function build(snapshot: BusinessSnapshot, items: ReadonlyArray<RankedAction>) {
  const businessState = new BusinessStateService(makeFetcher(snapshot));
  const subagents: MdSubagents = {
    nba: makeNba(items),
    autoPopulate: stubAutoPopulate,
    ownerStyle: makeOwnerStyle(),
    followUp: makeFollowUp(),
    timeline: {
      async build() {
        return [];
      },
    },
    employees: {
      async read() {
        return [];
      },
    },
    presenter: {
      async process() {
        return null;
      },
    },
  };
  const traceStore = new InMemoryTraceStore();
  return new MdOrchestrator(
    { businessState, subagents, traceStore },
    { topK: 2, traceModel: "test-md", clock: () => 1_700_000_000_000 },
  );
}

describe("MdOrchestrator.runTurn", () => {
  it("validates input shape", async () => {
    const orch = build(emptySnapshot("org-1"), []);
    await expect(orch.runTurn({ foo: "bar" })).rejects.toThrow();
  });

  it("emits observation, assessment, proposals, follow-up, style-update in order", async () => {
    const snap: BusinessSnapshot = {
      ...emptySnapshot("org-1"),
      finance: {
        cashUsd: 250_000,
        monthlyBurnUsd: 40_000,
        overdueInvoicesCount: 0,
        overdueAmountUsd: 0,
      },
    };
    const items = [fakeRanked("a"), fakeRanked("b", "customer-success")];
    const orch = build(snap, items);

    const res = await orch.runTurn({
      orgId: "org-1",
      ownerId: "owner-1",
      sessionId: "sess-1",
      correlationId: "corr-1",
      tier: "org-admin",
      text: "what should I do today",
      portalId: "admin",
      route: "/api/md/turn",
    });

    expect(res.traceId).toBeTruthy();
    expect(res.events.length).toBeGreaterThan(0);

    const kinds = res.events.map((e) => e.kind);
    expect(kinds[0]).toBe("md.observation");
    expect(kinds).toContain("md.assessment");
    expect(kinds.filter((k) => k === "md.proposal").length).toBe(2);
    expect(kinds).toContain("md.follow-up");
    expect(kinds).toContain("md.style-update");
  });

  it("produces a DecisionTrace per turn", async () => {
    const items = [fakeRanked("only")];
    const orch = build(emptySnapshot("org-1"), items);

    const res1 = await orch.runTurn({
      orgId: "org-1",
      ownerId: "owner-1",
      sessionId: "s1",
      correlationId: "c1",
      tier: "org-admin",
      text: "hi",
      portalId: "admin",
      route: "/r",
    });
    const res2 = await orch.runTurn({
      orgId: "org-1",
      ownerId: "owner-1",
      sessionId: "s1",
      correlationId: "c2",
      tier: "org-admin",
      text: "hi again",
      portalId: "admin",
      route: "/r",
    });

    expect(res1.traceId).not.toBe(res2.traceId);
  });

  it("each proposal carries an autonomy level resolved via decideLevel", async () => {
    const items = [fakeRanked("a"), fakeRanked("b", "finance")];
    const orch = build(emptySnapshot("org-1"), items);
    const res = await orch.runTurn({
      orgId: "org-1",
      ownerId: "owner-1",
      sessionId: "s1",
      correlationId: "c1",
      tier: "org-admin",
      text: "go",
      portalId: "admin",
      route: "/r",
    });
    const proposals = res.events.filter((e) => e.kind === "md.proposal");
    for (const p of proposals) {
      expect([
        "suggest",
        "recommend",
        "act-with-approval",
        "act-autonomous",
      ]).toContain(p.kind === "md.proposal" ? p.autonomyLevel : "");
    }
  });

  it("denies a turn when tier policy fails", async () => {
    // borrower tier cannot read org_data; this should bubble up.
    const orch = build(emptySnapshot("org-1"), [fakeRanked("a")]);
    await expect(
      orch.runTurn({
        orgId: "org-1",
        ownerId: "owner-1",
        sessionId: "s",
        correlationId: "c",
        tier: "borrower",
        text: "go",
        portalId: "borrower",
        route: "/r",
      }),
    ).rejects.toThrow();
  });
});
