/**
 * Closed-loop Supabase sink — tests the three sink methods route to the
 * right tables and swallow errors without throwing (so the runtime
 * heartbeat is never blocked by a transient persistence failure).
 *
 * Uses an in-memory SupabaseLike stub; no network is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSupabaseClosedLoopSink,
  type ClosedLoopSupabaseLike,
} from "../supabase-sink";
import type {
  ClosedLoopAdjustmentRow,
  ClosedLoopStateRow,
  ClosedLoopTickRow,
} from "../runtime";

interface Captured {
  table: string;
  method: "insert" | "upsert";
  rows: unknown;
}

function makeSupabaseStub(opts: { error?: { message: string } } = {}): {
  client: ClosedLoopSupabaseLike;
  captured: Captured[];
} {
  const captured: Captured[] = [];
  const client: ClosedLoopSupabaseLike = {
    from(table: string) {
      return {
        insert(rows: unknown) {
          captured.push({ table, method: "insert", rows });
          return Promise.resolve({ error: opts.error ?? null });
        },
        upsert(rows: unknown) {
          captured.push({ table, method: "upsert", rows });
          return Promise.resolve({ error: opts.error ?? null });
        },
      };
    },
  };
  return { client, captured };
}

function makeThrowingStub(): ClosedLoopSupabaseLike {
  return {
    from() {
      return {
        insert() {
          throw new Error("net");
        },
        upsert() {
          throw new Error("net");
        },
      };
    },
  };
}

const tick: ClosedLoopTickRow = Object.freeze({
  tick_id: "tick_1",
  loop_id: "kyc-verification",
  org_id: "org_a",
  borrower_id: null,
  application_id: null,
  tier: "borrower",
  correlation_id: "corr_1",
  started_at: "2026-05-24T00:00:00.000Z",
  ended_at: "2026-05-24T00:00:01.000Z",
  observation: {},
  decision: {},
  actions: Object.freeze([]),
  measurement: {},
  decision_trace_id: "trace_1",
  outcome: "success",
});

const adj: ClosedLoopAdjustmentRow = Object.freeze({
  id: "adj_1",
  tick_id: "tick_1",
  loop_id: "kyc-verification",
  org_id: "org_a",
  kind: "policy-tweak",
  description: "ok",
  delta: { reason: "ok" },
  belief_delta: null,
  recorded_at: "2026-05-24T00:00:00.000Z",
});

const state: ClosedLoopStateRow = Object.freeze({
  loop_id: "kyc-verification",
  org_id: "org_a",
  last_tick_id: "tick_1",
  last_tick_at: "2026-05-24T00:00:00.000Z",
  last_outcome: "success",
  drift_sigma: 0,
});

describe("supabase-sink", () => {
  // The sink logs errors via console.error; silence the logs so a
  // green test output doesn't get polluted with the deliberate misses
  // we drive below.
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it("insertTick writes to closed_loop_ticks", async () => {
    const { client, captured } = makeSupabaseStub();
    const sink = createSupabaseClosedLoopSink(client);
    await sink.insertTick(tick);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.table).toBe("closed_loop_ticks");
    expect(captured[0]?.method).toBe("insert");
  });

  it("insertAdjustments writes to closed_loop_adjustments", async () => {
    const { client, captured } = makeSupabaseStub();
    const sink = createSupabaseClosedLoopSink(client);
    await sink.insertAdjustments([adj]);
    expect(captured[0]?.table).toBe("closed_loop_adjustments");
    expect(captured[0]?.method).toBe("insert");
  });

  it("insertAdjustments is a no-op on empty array", async () => {
    const { client, captured } = makeSupabaseStub();
    const sink = createSupabaseClosedLoopSink(client);
    await sink.insertAdjustments([]);
    expect(captured).toHaveLength(0);
  });

  it("upsertState writes to closed_loops via upsert", async () => {
    const { client, captured } = makeSupabaseStub();
    const sink = createSupabaseClosedLoopSink(client);
    await sink.upsertState(state);
    expect(captured[0]?.table).toBe("closed_loops");
    expect(captured[0]?.method).toBe("upsert");
  });

  it("insertTick swallows supabase errors and logs", async () => {
    const { client } = makeSupabaseStub({ error: { message: "rls" } });
    const sink = createSupabaseClosedLoopSink(client);
    await expect(sink.insertTick(tick)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("insertAdjustments swallows supabase errors and logs", async () => {
    const { client } = makeSupabaseStub({ error: { message: "rls" } });
    const sink = createSupabaseClosedLoopSink(client);
    await expect(sink.insertAdjustments([adj])).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("upsertState swallows supabase errors and logs", async () => {
    const { client } = makeSupabaseStub({ error: { message: "rls" } });
    const sink = createSupabaseClosedLoopSink(client);
    await expect(sink.upsertState(state)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("insertTick swallows thrown exceptions and logs", async () => {
    const sink = createSupabaseClosedLoopSink(makeThrowingStub());
    await expect(sink.insertTick(tick)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("insertAdjustments swallows thrown exceptions and logs", async () => {
    const sink = createSupabaseClosedLoopSink(makeThrowingStub());
    await expect(sink.insertAdjustments([adj])).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("upsertState swallows thrown exceptions and logs", async () => {
    const sink = createSupabaseClosedLoopSink(makeThrowingStub());
    await expect(sink.upsertState(state)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
