import { describe, expect, it } from "vitest";
import { createInMemoryEventStore } from "../in-memory-store.js";
import { OptimisticConcurrencyError } from "../types.js";
import type { PaymentEvent } from "../events.js";

function rentDue(leaseId: string, amount = 50000): PaymentEvent {
  return {
    type: "rent.due.recorded",
    occurredAt: new Date().toISOString(),
    leaseId,
    amountCents: amount,
    currency: "KES",
    dueDate: "2026-06-01",
  };
}

function payInit(leaseId: string, ref: string, amount = 50000): PaymentEvent {
  return {
    type: "payment.initiated",
    occurredAt: new Date().toISOString(),
    leaseId,
    providerRef: ref,
    amountCents: amount,
    currency: "KES",
    provider: "mpesa",
  };
}

describe("createInMemoryEventStore", () => {
  it("append succeeds on empty stream with expectedVersion=0", async () => {
    const store = createInMemoryEventStore();
    const env = await store.append("lease:1", rentDue("l1"), 0);
    expect(env.version).toBe(1);
    expect(env.streamId).toBe("lease:1");
    expect(env.globalSeq).toBe(1);
  });

  it("version increments per stream", async () => {
    const store = createInMemoryEventStore();
    await store.append("lease:1", rentDue("l1"), 0);
    const e2 = await store.append("lease:1", payInit("l1", "ref"), 1);
    expect(e2.version).toBe(2);
  });

  it("append fails on version mismatch", async () => {
    const store = createInMemoryEventStore();
    await store.append("lease:1", rentDue("l1"), 0);
    await expect(
      store.append("lease:1", payInit("l1", "ref"), 0)
    ).rejects.toBeInstanceOf(OptimisticConcurrencyError);
  });

  it("read returns all envelopes when fromVersion omitted", async () => {
    const store = createInMemoryEventStore();
    await store.append("lease:1", rentDue("l1"), 0);
    await store.append("lease:1", payInit("l1", "r1"), 1);
    const all = await store.read("lease:1");
    expect(all).toHaveLength(2);
  });

  it("read respects fromVersion", async () => {
    const store = createInMemoryEventStore();
    await store.append("lease:1", rentDue("l1"), 0);
    await store.append("lease:1", payInit("l1", "r1"), 1);
    const slice = await store.read("lease:1", 1);
    expect(slice).toHaveLength(1);
    expect(slice[0]?.version).toBe(2);
  });

  it("read on unknown stream returns []", async () => {
    const store = createInMemoryEventStore();
    const out = await store.read("lease:999");
    expect(out).toEqual([]);
  });

  it("streams are isolated per streamId", async () => {
    const store = createInMemoryEventStore();
    await store.append("lease:1", rentDue("l1"), 0);
    await store.append("lease:2", rentDue("l2"), 0);
    expect(await store.read("lease:1")).toHaveLength(1);
    expect(await store.read("lease:2")).toHaveLength(1);
  });

  it("globalSeq is monotonic across streams", async () => {
    const store = createInMemoryEventStore();
    const a = await store.append("lease:1", rentDue("l1"), 0);
    const b = await store.append("lease:2", rentDue("l2"), 0);
    const c = await store.append("lease:1", payInit("l1", "r"), 1);
    expect(a.globalSeq).toBe(1);
    expect(b.globalSeq).toBe(2);
    expect(c.globalSeq).toBe(3);
  });

  it("subscribe fires on append", async () => {
    const store = createInMemoryEventStore();
    let count = 0;
    store.subscribe({}, () => {
      count += 1;
    });
    await store.append("lease:1", rentDue("l1"), 0);
    expect(count).toBe(1);
  });

  it("subscribe respects streamId filter", async () => {
    const store = createInMemoryEventStore();
    let count = 0;
    store.subscribe({ streamId: "lease:1" }, () => {
      count += 1;
    });
    await store.append("lease:1", rentDue("l1"), 0);
    await store.append("lease:2", rentDue("l2"), 0);
    expect(count).toBe(1);
  });

  it("subscribe respects eventTypes filter", async () => {
    const store = createInMemoryEventStore();
    let count = 0;
    store.subscribe({ eventTypes: ["payment.initiated"] }, () => {
      count += 1;
    });
    await store.append("lease:1", rentDue("l1"), 0);
    await store.append("lease:1", payInit("l1", "ref"), 1);
    expect(count).toBe(1);
  });

  it("unsubscribe stops delivery", async () => {
    const store = createInMemoryEventStore();
    let count = 0;
    const unsub = store.subscribe({}, () => {
      count += 1;
    });
    await store.append("lease:1", rentDue("l1"), 0);
    unsub();
    await store.append("lease:1", payInit("l1", "ref"), 1);
    expect(count).toBe(1);
  });

  it("envelopes carry recordedAt as ISO string", async () => {
    const store = createInMemoryEventStore();
    const env = await store.append("lease:1", rentDue("l1"), 0);
    expect(env.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("OptimisticConcurrencyError carries diagnostic info", async () => {
    const store = createInMemoryEventStore();
    await store.append("lease:1", rentDue("l1"), 0);
    try {
      await store.append("lease:1", rentDue("l1"), 5);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OptimisticConcurrencyError);
      const err = e as OptimisticConcurrencyError;
      expect(err.code).toBe("OPTIMISTIC_CONCURRENCY");
      expect(err.expectedVersion).toBe(5);
      expect(err.actualVersion).toBe(1);
    }
  });
});
