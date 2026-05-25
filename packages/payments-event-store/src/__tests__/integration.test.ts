import { describe, expect, it } from "vitest";
import { createInMemoryEventStore } from "../in-memory-store.js";
import { project } from "../projector.js";
import type { PaymentEvent } from "../events.js";
import type { EventEnvelope } from "../types.js";

/** End-to-end scenarios that mirror real rent + arrears flows. */

function streamId(leaseId: string): string {
  return `lease:${leaseId}`;
}

const now = () => new Date().toISOString();

describe("integration: rent collection flow", () => {
  it("happy path: rent.due -> payment.initiated -> payment.confirmed -> rent.reconciled", async () => {
    const store = createInMemoryEventStore();
    const sid = streamId("l-001");

    const due = await store.append(
      sid,
      {
        type: "rent.due.recorded",
        occurredAt: now(),
        leaseId: "l-001",
        amountCents: 100_000,
        currency: "KES",
        dueDate: "2026-06-01",
      },
      0
    );
    expect(due.version).toBe(1);

    const init = await store.append(
      sid,
      {
        type: "payment.initiated",
        occurredAt: now(),
        leaseId: "l-001",
        providerRef: "MPSA-001",
        amountCents: 100_000,
        currency: "KES",
        provider: "mpesa",
      },
      1
    );
    expect(init.version).toBe(2);

    const conf = await store.append(
      sid,
      {
        type: "payment.confirmed",
        occurredAt: now(),
        leaseId: "l-001",
        providerRef: "MPSA-001",
        amountCents: 100_000,
        currency: "KES",
      },
      2
    );
    expect(conf.version).toBe(3);

    const recon = await store.append(
      sid,
      {
        type: "rent.reconciled",
        occurredAt: now(),
        leaseId: "l-001",
        paidCents: 100_000,
        currency: "KES",
        remainingArrearsCents: 0,
      },
      3
    );
    expect(recon.version).toBe(4);

    const all = await store.read(sid);
    expect(all).toHaveLength(4);
  });

  it("payment.failed leaves the stream open for retry", async () => {
    const store = createInMemoryEventStore();
    const sid = streamId("l-002");

    await store.append(
      sid,
      {
        type: "rent.due.recorded",
        occurredAt: now(),
        leaseId: "l-002",
        amountCents: 50_000,
        currency: "TZS",
        dueDate: "2026-06-01",
      },
      0
    );
    await store.append(
      sid,
      {
        type: "payment.initiated",
        occurredAt: now(),
        leaseId: "l-002",
        providerRef: "MPSA-fail",
        amountCents: 50_000,
        currency: "TZS",
        provider: "mpesa",
      },
      1
    );
    const failed = await store.append(
      sid,
      {
        type: "payment.failed",
        occurredAt: now(),
        leaseId: "l-002",
        providerRef: "MPSA-fail",
        failureCode: "1037",
        failureMessage: "DS timeout user not reached",
      },
      2
    );
    expect(failed.version).toBe(3);

    // Retry — same stream, no version reset.
    const retry = await store.append(
      sid,
      {
        type: "payment.initiated",
        occurredAt: now(),
        leaseId: "l-002",
        providerRef: "MPSA-retry",
        amountCents: 50_000,
        currency: "TZS",
        provider: "mpesa",
      },
      3
    );
    expect(retry.version).toBe(4);
  });
});

describe("integration: arrears projector", () => {
  it("projects running arrears balance from accruals + reconciliations", async () => {
    const store = createInMemoryEventStore();
    const sid = streamId("l-003");

    await store.append(
      sid,
      {
        type: "rent.due.recorded",
        occurredAt: now(),
        leaseId: "l-003",
        amountCents: 50_000,
        currency: "KES",
        dueDate: "2026-04-01",
      },
      0
    );
    await store.append(
      sid,
      {
        type: "arrears.accrued",
        occurredAt: now(),
        leaseId: "l-003",
        arrearsCents: 50_000,
        currency: "KES",
        fromDueDate: "2026-04-01",
      },
      1
    );
    await store.append(
      sid,
      {
        type: "arrears.accrued",
        occurredAt: now(),
        leaseId: "l-003",
        arrearsCents: 50_000,
        currency: "KES",
        fromDueDate: "2026-05-01",
      },
      2
    );
    // Partial payment.
    await store.append(
      sid,
      {
        type: "rent.reconciled",
        occurredAt: now(),
        leaseId: "l-003",
        paidCents: 50_000,
        currency: "KES",
        remainingArrearsCents: 50_000,
      },
      3
    );

    const events = await store.read(sid);
    interface S { totalArrearsCents: number }
    const out = project<S>(
      events,
      { totalArrearsCents: 0 },
      {
        "arrears.accrued": (s, e) => ({
          totalArrearsCents: s.totalArrearsCents + e.arrearsCents,
        }),
        "rent.reconciled": (_s, e) => ({
          totalArrearsCents: e.remainingArrearsCents,
        }),
      }
    );
    expect(out.totalArrearsCents).toBe(50_000);
  });

  it("arrears.forgiven zeros out the running balance", async () => {
    const store = createInMemoryEventStore();
    const sid = streamId("l-004");

    await store.append(
      sid,
      {
        type: "arrears.accrued",
        occurredAt: now(),
        leaseId: "l-004",
        arrearsCents: 200_000,
        currency: "NGN",
        fromDueDate: "2026-03-01",
      },
      0
    );
    await store.append(
      sid,
      {
        type: "arrears.forgiven",
        occurredAt: now(),
        leaseId: "l-004",
        forgivenCents: 200_000,
        currency: "NGN",
        approvedBy: "ops-mgr-1",
        reason: "Tenant lost employment due to natural disaster",
      },
      1
    );

    const events = await store.read(sid);
    interface S { totalArrearsCents: number }
    const out = project<S>(
      events,
      { totalArrearsCents: 0 },
      {
        "arrears.accrued": (s, e) => ({
          totalArrearsCents: s.totalArrearsCents + e.arrearsCents,
        }),
        "arrears.forgiven": (s, e) => ({
          totalArrearsCents: s.totalArrearsCents - e.forgivenCents,
        }),
      }
    );
    expect(out.totalArrearsCents).toBe(0);
  });

  it("subscription delivers events in order", async () => {
    const store = createInMemoryEventStore();
    const received: EventEnvelope[] = [];
    store.subscribe({ streamId: streamId("l-sub") }, (env) => {
      received.push(env);
    });

    const events: PaymentEvent[] = [
      {
        type: "rent.due.recorded",
        occurredAt: now(),
        leaseId: "l-sub",
        amountCents: 1000,
        currency: "KES",
        dueDate: "2026-06-01",
      },
      {
        type: "payment.initiated",
        occurredAt: now(),
        leaseId: "l-sub",
        providerRef: "r",
        amountCents: 1000,
        currency: "KES",
        provider: "mpesa",
      },
    ];

    for (const [i, ev] of events.entries()) {
      await store.append(streamId("l-sub"), ev, i);
    }
    expect(received).toHaveLength(2);
    expect(received[0]?.version).toBe(1);
    expect(received[1]?.version).toBe(2);
  });

  it("concurrent appends with same expectedVersion: only one succeeds", async () => {
    const store = createInMemoryEventStore();
    const sid = streamId("l-race");
    await store.append(
      sid,
      {
        type: "rent.due.recorded",
        occurredAt: now(),
        leaseId: "l-race",
        amountCents: 1000,
        currency: "KES",
        dueDate: "2026-06-01",
      },
      0
    );
    // Both targets v2.
    const a = store.append(
      sid,
      {
        type: "payment.initiated",
        occurredAt: now(),
        leaseId: "l-race",
        providerRef: "A",
        amountCents: 1000,
        currency: "KES",
        provider: "mpesa",
      },
      1
    );
    const b = store.append(
      sid,
      {
        type: "payment.initiated",
        occurredAt: now(),
        leaseId: "l-race",
        providerRef: "B",
        amountCents: 1000,
        currency: "KES",
        provider: "mpesa",
      },
      1
    );
    const results = await Promise.allSettled([a, b]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("event ordering: globalSeq strictly increases across all appends", async () => {
    const store = createInMemoryEventStore();
    const seqs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const env = await store.append(
        streamId(`l-${i}`),
        {
          type: "rent.due.recorded",
          occurredAt: now(),
          leaseId: `l-${i}`,
          amountCents: 1000,
          currency: "KES",
          dueDate: "2026-06-01",
        },
        0
      );
      seqs.push(env.globalSeq);
    }
    for (let i = 1; i < seqs.length; i += 1) {
      const prev = seqs[i - 1] ?? 0;
      const cur = seqs[i] ?? 0;
      expect(cur).toBeGreaterThan(prev);
    }
  });

  it("event payload survives append-then-read round-trip", async () => {
    const store = createInMemoryEventStore();
    const original: PaymentEvent = {
      type: "payment.confirmed",
      occurredAt: now(),
      leaseId: "l-rt",
      providerRef: "R-RT",
      amountCents: 99_999,
      currency: "TZS",
    };
    await store.append(streamId("l-rt"), original, 0);
    const [back] = await store.read(streamId("l-rt"));
    expect(back?.event).toEqual(original);
  });
});

describe("integration: event-type discriminator helps exhaustive switching", () => {
  it("switch on type narrows to the right shape", () => {
    const events: PaymentEvent[] = [
      {
        type: "rent.due.recorded",
        occurredAt: now(),
        leaseId: "l-d",
        amountCents: 1,
        currency: "KES",
        dueDate: "2026",
      },
      {
        type: "payment.initiated",
        occurredAt: now(),
        leaseId: "l-d",
        providerRef: "r",
        amountCents: 1,
        currency: "KES",
        provider: "stripe",
      },
    ];
    const summary: string[] = [];
    for (const e of events) {
      switch (e.type) {
        case "rent.due.recorded":
          summary.push(`due ${e.dueDate}`);
          break;
        case "payment.initiated":
          summary.push(`init via ${e.provider}`);
          break;
        default:
          summary.push("other");
      }
    }
    expect(summary).toEqual(["due 2026", "init via stripe"]);
  });
});
