import { describe, expect, it } from "vitest";
import {
  createInMemorySink,
  createRecorderState,
  recordDenial,
  DenialReason,
} from "../index.js";

const baseInput = {
  actorUserId: "u-1",
  actorTenantId: "t-A",
  targetTenantId: "t-B",
  route: "/api/properties/123",
  httpMethod: "GET",
  reason: DenialReason.RLS_DENIED,
};

describe("recordDenial — happy path", () => {
  it("writes a row to the sink with deniedAtIso stamped", async () => {
    const sink = createInMemorySink();
    const state = createRecorderState();
    const r = await recordDenial(sink, baseInput, {
      state,
      nowMs: () => 1717_000_000_000,
    });
    expect(r.admitted).toBe(true);
    expect(sink.size()).toBe(1);
    const row = sink.rows()[0];
    expect(row.targetTenantId).toBe("t-B");
    expect(row.deniedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.reason).toBe("RLS_DENIED");
  });

  it("accepts a custom reason string (open-set)", async () => {
    const sink = createInMemorySink();
    await recordDenial(
      sink,
      { ...baseInput, reason: "CUSTOM_REASON_XYZ" },
      { state: createRecorderState() },
    );
    expect(sink.rows()[0].reason).toBe("CUSTOM_REASON_XYZ");
  });
});

describe("recordDenial — validation", () => {
  it("drops rows missing targetTenantId", async () => {
    const sink = createInMemorySink();
    const r = await recordDenial(
      sink,
      { ...baseInput, targetTenantId: "" },
      { state: createRecorderState() },
    );
    expect(r.admitted).toBe(false);
    expect(sink.size()).toBe(0);
  });

  it("drops rows missing route", async () => {
    const sink = createInMemorySink();
    const r = await recordDenial(
      sink,
      { ...baseInput, route: "" },
      { state: createRecorderState() },
    );
    expect(r.admitted).toBe(false);
  });

  it("drops rows missing httpMethod", async () => {
    const sink = createInMemorySink();
    const r = await recordDenial(
      sink,
      { ...baseInput, httpMethod: "" },
      { state: createRecorderState() },
    );
    expect(r.admitted).toBe(false);
  });

  it("drops rows with empty reason", async () => {
    const sink = createInMemorySink();
    const r = await recordDenial(
      sink,
      { ...baseInput, reason: "" },
      { state: createRecorderState() },
    );
    expect(r.admitted).toBe(false);
  });
});

describe("recordDenial — rate limit", () => {
  it("admits the first write, drops subsequent same-bucket writes inside 1s", async () => {
    const sink = createInMemorySink();
    const state = createRecorderState();
    let t = 0;
    const r1 = await recordDenial(sink, baseInput, {
      state,
      nowMs: () => t,
    });
    t = 500;
    const r2 = await recordDenial(sink, baseInput, {
      state,
      nowMs: () => t,
    });
    expect(r1.admitted).toBe(true);
    expect(r2.admitted).toBe(false);
    expect(sink.size()).toBe(1);
  });

  it("admits a write 1.5s later", async () => {
    const sink = createInMemorySink();
    const state = createRecorderState();
    let t = 0;
    await recordDenial(sink, baseInput, { state, nowMs: () => t });
    t = 1_500;
    const r = await recordDenial(sink, baseInput, {
      state,
      nowMs: () => t,
    });
    expect(r.admitted).toBe(true);
    expect(sink.size()).toBe(2);
  });

  it("separates rate-limit buckets by (actor, target) pair", async () => {
    const sink = createInMemorySink();
    const state = createRecorderState();
    const a = await recordDenial(sink, baseInput, {
      state,
      nowMs: () => 0,
    });
    const b = await recordDenial(
      sink,
      { ...baseInput, targetTenantId: "t-C" },
      { state, nowMs: () => 100 },
    );
    expect(a.admitted).toBe(true);
    expect(b.admitted).toBe(true);
  });

  it("stamps droppedSincePreviousAdmit on the next admitted row", async () => {
    const sink = createInMemorySink();
    const state = createRecorderState();
    let t = 0;
    await recordDenial(sink, baseInput, { state, nowMs: () => t });
    t = 100;
    await recordDenial(sink, baseInput, { state, nowMs: () => t });
    t = 200;
    await recordDenial(sink, baseInput, { state, nowMs: () => t });
    t = 1_500;
    await recordDenial(sink, baseInput, { state, nowMs: () => t });
    const last = sink.rows()[sink.rows().length - 1];
    expect(
      (last.metadata as Record<string, unknown>).droppedSincePreviousAdmit,
    ).toBe(2);
  });

  it("swallows sink write errors and reports admitted=false", async () => {
    const sink = {
      async write() {
        throw new Error("db_down");
      },
    };
    const r = await recordDenial(sink, baseInput, {
      state: createRecorderState(),
    });
    expect(r.admitted).toBe(false);
  });
});
