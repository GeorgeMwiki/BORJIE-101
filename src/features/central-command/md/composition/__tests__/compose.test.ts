/**
 * Composition root — integration tests.
 *
 * These tests exercise the whole MD subagent bundle:
 *   - NBA adapter passes ranked actions through.
 *   - Owner-style adapter reshapes the underlying profile to the
 *     orchestrator's narrower contract.
 *   - Follow-up adapter persists a row via the in-memory persister and
 *     can list-due back what was scheduled.
 *   - Auto-populate adapter projects entities matching the target.
 *   - Tier policy is enforced — calling with an unprivileged tier rejects.
 *
 * These are NOT mock-everything tests. The owner-style service is a real
 * `createOwnerStyleService()` with the default in-memory store. The
 * follow-up persister is a tiny real in-memory implementation. NBA and
 * auto-populate are typed fakes that return deterministic data.
 *
 * @module features/central-command/md/composition/__tests__/compose
 */

import { describe, expect, it } from "vitest";

import type { FollowUp } from "@/features/central-command/md/follow-up/types";
import type { FollowUpPersister } from "@/features/central-command/md/follow-up/persister";
import { createOwnerStyleService } from "@/features/central-command/md/owner-style/owner-style-service";
import type { NbaServicePort } from "@/features/central-command/md/nba";
import type {
  BusinessSnapshot,
  RankedAction,
} from "@/features/central-command/md/core/contracts";

import { createMdSubagents } from "../compose";
import type { ProcessChatFn } from "../auto-populate-adapter";
import type { RequestContext } from "../request-context";

const FIXED_NOW = new Date("2026-05-17T08:00:00.000Z");

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return Object.freeze({
    tier: "borjie-admin" as const,
    tenantId: "tenant-acme",
    sessionId: "sess-1",
    correlationId: "corr-1",
    userId: "user-owner-1",
    ...overrides,
  });
}

function makeInMemoryFollowUpPersister(): FollowUpPersister & {
  readonly snapshot: () => ReadonlyArray<FollowUp>;
} {
  const rows = new Map<string, FollowUp>();
  return {
    async upsert(fu) {
      rows.set(fu.id, fu);
    },
    async upsertMany(fus) {
      for (const fu of fus) rows.set(fu.id, fu);
    },
    async listPending(tenantId) {
      return Object.freeze(
        Array.from(rows.values()).filter(
          (fu) =>
            fu.tenantId === tenantId &&
            (fu.status === "pending" || fu.status === "escalated"),
        ),
      );
    },
    async setStatus(id, status) {
      const fu = rows.get(id);
      if (fu) rows.set(id, { ...fu, status });
    },
    snapshot: () => Object.freeze(Array.from(rows.values())),
  };
}

function makeFakeNbaService(): NbaServicePort {
  const sample: RankedAction = {
    actionId: "act-1",
    domain: "sales",
    title: "Send NPS survey to top 10 customers",
    rationale: "Recent NPS coverage is stale; quick win, low cost.",
    iceScore: { impact: 7, confidence: 0.8, ease: 8, composite: 44.8 },
    riceScore: {
      reach: 10,
      impact: 7,
      confidence: 0.8,
      effort: 1,
      composite: 56,
    },
    wsjfScore: 7.5,
    eisenhower: {
      urgent: false,
      important: true,
      quadrant: "important-not-urgent",
    },
    estimatedDurationMinutes: 30,
  } as unknown as RankedAction;

  return {
    async rankActions(_snapshot: BusinessSnapshot, k: number) {
      return Object.freeze(Array.from({ length: k }, () => sample));
    },
    async getNextLowHangingFruit() {
      return sample;
    },
    async getNextHighImpact() {
      return sample;
    },
    async getDailyAgenda() {
      return Object.freeze([sample]);
    },
  };
}

function makeFakeProcessChat(): ProcessChatFn {
  return async (_turnId, text, _ctx) => {
    return {
      entities: text.toLowerCase().includes("employee")
        ? [
            {
              kind: "employee",
              confidence: 0.92,
              data: { name: "Alice Mwende", role: "Engineer" },
            },
          ]
        : [],
    };
  };
}

const EMPTY_SNAPSHOT: BusinessSnapshot = {
  orgId: "tenant-acme",
  asOfMs: FIXED_NOW.getTime(),
  employees: [],
  customers: [],
  finance: { runwayMonths: 18, cashOnHand: 1_000_000, monthlyBurn: 50_000 },
  compliance: [],
  learning: [],
  recentDecisions: [],
  pendingFollowUps: [],
} as unknown as BusinessSnapshot;

describe("MD composition root", () => {
  it("rankActions returns the top-k from NBA", async () => {
    const ctx = makeCtx();
    const subagents = createMdSubagents({
      ctx,
      nbaService: makeFakeNbaService(),
      ownerStyleService: createOwnerStyleService(),
      followUpPersister: makeInMemoryFollowUpPersister(),
      autoPopulateProcessChat: makeFakeProcessChat(),
    });

    const ranked = await subagents.nba.rankActions(EMPTY_SNAPSHOT, 3);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.title).toBe("Send NPS survey to top 10 customers");
  });

  it("ownerStyle.getProfile reshapes the underlying profile", async () => {
    const ctx = makeCtx();
    const subagents = createMdSubagents({
      ctx,
      nbaService: makeFakeNbaService(),
      ownerStyleService: createOwnerStyleService(),
      followUpPersister: makeInMemoryFollowUpPersister(),
      autoPopulateProcessChat: makeFakeProcessChat(),
    });

    const profile = await subagents.ownerStyle.getProfile("user-owner-1");
    expect(profile).not.toBeNull();
    expect(profile?.ownerId).toBe("user-owner-1");
    expect(profile?.confidence).toBeGreaterThanOrEqual(0);
    expect(profile?.confidence).toBeLessThanOrEqual(1);
    expect(profile?.tonePrefs.length).toBeGreaterThan(0);
  });

  it("ownerStyle.refine blends observations into the profile", async () => {
    const ctx = makeCtx();
    const subagents = createMdSubagents({
      ctx,
      nbaService: makeFakeNbaService(),
      ownerStyleService: createOwnerStyleService(),
      followUpPersister: makeInMemoryFollowUpPersister(),
      autoPopulateProcessChat: makeFakeProcessChat(),
    });

    const out = await subagents.ownerStyle.refine("user-owner-1", [
      { text: "just do it. no need to overthink.", tsMs: FIXED_NOW.getTime() },
    ]);
    expect(out.profile.ownerId).toBe("user-owner-1");
    expect(out.changeNote).toContain("1 observation");
  });

  it("followUp.schedule persists and listDue returns it", async () => {
    const ctx = makeCtx();
    const persister = makeInMemoryFollowUpPersister();
    const subagents = createMdSubagents({
      ctx,
      nbaService: makeFakeNbaService(),
      ownerStyleService: createOwnerStyleService(),
      followUpPersister: persister,
      autoPopulateProcessChat: makeFakeProcessChat(),
      clock: () => FIXED_NOW,
      idGen: () => "00000000-0000-0000-0000-000000000001",
    });

    const dueAtMs = FIXED_NOW.getTime() + 24 * 60 * 60 * 1000;
    const record = await subagents.followUp.schedule({
      orgId: "tenant-acme",
      ownerId: "user-owner-1",
      title: "Review supplier contract Z",
      dueAtMs,
    });

    expect(record.followUpId).toBe("00000000-0000-0000-0000-000000000001");
    expect(record.title).toBe("Review supplier contract Z");
    expect(record.dueAtMs).toBe(dueAtMs);

    const due = await subagents.followUp.listDue("tenant-acme", dueAtMs + 1000);
    expect(due).toHaveLength(1);
    expect(due[0]?.followUpId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("followUp.schedule rejects unprivileged tier", async () => {
    const ctx = makeCtx({ tier: "borrower" as const });
    const subagents = createMdSubagents({
      ctx,
      nbaService: makeFakeNbaService(),
      ownerStyleService: createOwnerStyleService(),
      followUpPersister: makeInMemoryFollowUpPersister(),
      autoPopulateProcessChat: makeFakeProcessChat(),
    });

    await expect(
      subagents.followUp.schedule({
        orgId: "tenant-acme",
        ownerId: "user-owner-1",
        title: "test",
        dueAtMs: FIXED_NOW.getTime(),
      }),
    ).rejects.toThrow();
  });

  it("autoPopulate.populate projects matching entity onto fields", async () => {
    const ctx = makeCtx();
    const subagents = createMdSubagents({
      ctx,
      nbaService: makeFakeNbaService(),
      ownerStyleService: createOwnerStyleService(),
      followUpPersister: makeInMemoryFollowUpPersister(),
      autoPopulateProcessChat: makeFakeProcessChat(),
    });

    const out = await subagents.autoPopulate.populate({
      orgId: "tenant-acme",
      hint: "we hired a new employee, Alice, last week.",
      target: "employee",
      tier: "borjie-admin",
    });

    expect(out.ok).toBe(true);
    expect(out.fields.name).toBe("Alice Mwende");
    expect(out.gaps).toHaveLength(0);
    expect(out.provenance.name).toBe("chat:auto-populate");
  });

  it("autoPopulate.populate returns gaps when no entity matches", async () => {
    const ctx = makeCtx();
    const subagents = createMdSubagents({
      ctx,
      nbaService: makeFakeNbaService(),
      ownerStyleService: createOwnerStyleService(),
      followUpPersister: makeInMemoryFollowUpPersister(),
      autoPopulateProcessChat: makeFakeProcessChat(),
    });

    const out = await subagents.autoPopulate.populate({
      orgId: "tenant-acme",
      hint: "we signed Acme Corp as a new customer.",
      target: "employee",
      tier: "borjie-admin",
    });

    expect(out.ok).toBe(true);
    expect(Object.keys(out.fields)).toHaveLength(0);
    expect(out.gaps).toContain("target:employee:no-match");
  });
});
