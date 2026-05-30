/**
 * Tests — JuniorAgentExecutor. Covers cooldown, payload validation,
 * hard budget, hash-chain audit row, and successful execute().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { SchemaRegistryService } from "../../schema-registry/schema-registry-service";
import {
  __resetJuniorCooldownCacheForTests,
  __resetJuniorHashSecretForTests,
  makeJuniorExecutor,
  type JuniorExecutorSupabaseLike,
} from "../executor";
import type { JuniorRunContext, JuniorRunResult, MdJuniorPort } from "../types";

const ORG = "00000000-0000-0000-0000-000000000010";

interface AuditRow {
  id: string;
  org_id: string;
  junior_id: string;
  trigger_kind: string;
  outcome: string;
  proposals_filed: number;
  rows_processed: number;
  duration_ms: number;
  error_message: string | null;
  sequence_id: number;
  prev_hash: string | null;
  row_hash: string;
  created_at: string;
}

function makeFakeSupabase(): {
  api: JuniorExecutorSupabaseLike;
  rows: AuditRow[];
} {
  const rows: AuditRow[] = [];
  const api: JuniorExecutorSupabaseLike = {
    from(table: string) {
      if (table !== "junior_runs")
        throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          let filterOrg: string | undefined;
          const builder = {
            eq(col: string, val: unknown) {
              if (col === "org_id") filterOrg = String(val);
              return builder;
            },
            order() {
              return builder;
            },
            limit() {
              const filtered = rows.filter(
                (r) => filterOrg === undefined || r.org_id === filterOrg,
              );
              const sorted = [...filtered].sort(
                (a, b) => b.sequence_id - a.sequence_id,
              );
              return Promise.resolve({ data: sorted, error: null });
            },
          };
          return builder;
        },
        insert(input: unknown) {
          const incoming = Array.isArray(input) ? input : [input];
          for (const r of incoming) rows.push(r as AuditRow);
          return Promise.resolve({ data: incoming, error: null });
        },
        update() {
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
  return { api, rows };
}

const fakeRegistry: SchemaRegistryService = {
  proposeField: async () => ({ ok: true, proposalId: "p" }),
  approveField: async () => ({ ok: true, proposalId: "p", fieldId: "f" }),
  rejectField: async () => ({ ok: true }),
  listPending: async () => [],
  listLiveFields: async () => [],
};

function junior(overrides: Partial<MdJuniorPort> = {}): MdJuniorPort {
  return Object.freeze({
    id: "test-junior",
    label: "Test",
    domain: "ops",
    trigger: { kind: "manual", invokedBy: "test" },
    guardrails: {
      maxRowsPerRun: 100,
      maxProposalsPerRun: 4,
      cooldownMs: 30_000,
      maxDurationMs: 5_000,
      allowedTables: [],
    },
    payloadSchema: z.object({ value: z.string().min(1) }),
    description: "test junior",
    async execute(): Promise<JuniorRunResult> {
      return {
        outcome: "ok",
        proposalsFiled: 2,
        rowsProcessed: 10,
        summary: "did the thing",
      };
    },
    ...overrides,
  });
}

describe("makeJuniorExecutor", () => {
  beforeEach(() => {
    __resetJuniorCooldownCacheForTests();
    __resetJuniorHashSecretForTests();
    // NODE_ENV is read-only on TS types; tests don't need to set it.
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("happy path: executes + persists audit row with hash chain", async () => {
    const fake = makeFakeSupabase();
    const exec = makeJuniorExecutor({
      supabase: fake.api,
      schemaRegistry: fakeRegistry,
      hashSecret: "test-secret-x".padEnd(40, "x"),
    });
    const out = await exec.run({
      junior: junior(),
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "hi" },
    });
    expect(out.result.outcome).toBe("ok");
    expect(out.result.proposalsFiled).toBe(2);
    expect(out.record).not.toBeNull();
    expect(out.record!.sequenceId).toBe(1);
    expect(out.record!.prevHash).toBeNull();
    expect(out.record!.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.rows.length).toBe(1);
  });

  it("rate-limits a second run within cooldown", async () => {
    const fake = makeFakeSupabase();
    const exec = makeJuniorExecutor({
      supabase: fake.api,
      schemaRegistry: fakeRegistry,
      hashSecret: "test-secret-x".padEnd(40, "x"),
    });
    await exec.run({
      junior: junior(),
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "first" },
    });
    const second = await exec.run({
      junior: junior(),
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "second" },
    });
    expect(second.result.outcome).toBe("rate_limited");
    expect(second.skipped).toBe("rate_limited");
    expect(fake.rows.length).toBe(2); // one ok + one rate-limited audit
  });

  it("rejects invalid payload as skipped_policy", async () => {
    const fake = makeFakeSupabase();
    const exec = makeJuniorExecutor({
      supabase: fake.api,
      schemaRegistry: fakeRegistry,
      hashSecret: "test-secret-x".padEnd(40, "x"),
    });
    const out = await exec.run({
      junior: junior(),
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "" }, // fails z.string().min(1)
    });
    expect(out.result.outcome).toBe("skipped_policy");
    expect(out.skipped).toBe("payload_invalid");
  });

  it("catches execute() throws and records error", async () => {
    const fake = makeFakeSupabase();
    const exec = makeJuniorExecutor({
      supabase: fake.api,
      schemaRegistry: fakeRegistry,
      hashSecret: "test-secret-x".padEnd(40, "x"),
    });
    const throwy = junior({
      async execute(): Promise<JuniorRunResult> {
        throw new Error("kaboom");
      },
    });
    const out = await exec.run({
      junior: throwy,
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "hi" },
    });
    expect(out.result.outcome).toBe("error");
    expect(out.result.errorMessage).toMatch(/kaboom/);
    expect(out.record!.outcome).toBe("error");
  });

  it("chains the hash: row 2 prev_hash equals row 1 row_hash", async () => {
    const fake = makeFakeSupabase();
    const exec = makeJuniorExecutor({
      supabase: fake.api,
      schemaRegistry: fakeRegistry,
      hashSecret: "test-secret-x".padEnd(40, "x"),
    });

    // Use two different juniors with cooldownMs:0 so we can chain two runs.
    const noCooldown = junior({
      id: "j1",
      guardrails: {
        maxRowsPerRun: 100,
        maxProposalsPerRun: 4,
        cooldownMs: 0,
        maxDurationMs: 5_000,
        allowedTables: [],
      },
    });
    const first = await exec.run({
      junior: noCooldown,
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "a" },
    });
    const second = await exec.run({
      junior: junior({
        id: "j2",
        guardrails: {
          ...noCooldown.guardrails,
        },
      }),
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "b" },
    });
    expect(second.record!.prevHash).toBe(first.record!.rowHash);
    expect(second.record!.sequenceId).toBe(2);
  });

  it("aborts at maxDurationMs", async () => {
    vi.useFakeTimers();
    const fake = makeFakeSupabase();
    const exec = makeJuniorExecutor({
      supabase: fake.api,
      schemaRegistry: fakeRegistry,
      hashSecret: "test-secret-x".padEnd(40, "x"),
    });
    const slow = junior({
      guardrails: {
        maxRowsPerRun: 100,
        maxProposalsPerRun: 4,
        cooldownMs: 0,
        maxDurationMs: 50,
        allowedTables: [],
      },
      async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 10_000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted by signal"));
          });
        });
        return {
          outcome: "ok",
          proposalsFiled: 0,
          rowsProcessed: 0,
          summary: "should not reach",
        };
      },
    });
    const promise = exec.run({
      junior: slow,
      orgId: ORG,
      triggerKind: "manual",
      payload: { value: "hi" },
    });
    await vi.advanceTimersByTimeAsync(60);
    const out = await promise;
    expect(out.result.outcome).toBe("error");
    expect(out.result.errorMessage).toMatch(/aborted/);
  });
});
