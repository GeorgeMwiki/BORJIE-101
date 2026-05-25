import { describe, expect, it } from "vitest";
import { project } from "../projector.js";
import type { EventEnvelope } from "../types.js";
import type {
  ArrearsAccrued,
  PaymentEvent,
  RentDueRecorded,
  RentReconciled,
} from "../events.js";

function env(event: PaymentEvent, version = 1): EventEnvelope {
  return {
    streamId: "lease:1",
    version,
    globalSeq: version,
    event,
    recordedAt: new Date().toISOString(),
  };
}

interface ArrearsState {
  readonly totalArrearsCents: number;
}

describe("project", () => {
  it("returns initial state when no events", () => {
    const out = project<ArrearsState>([], { totalArrearsCents: 0 }, {});
    expect(out.totalArrearsCents).toBe(0);
  });

  it("applies reducers for matching events", () => {
    const events: EventEnvelope[] = [
      env(
        {
          type: "arrears.accrued",
          occurredAt: "2026-05-01T00:00:00Z",
          leaseId: "l1",
          arrearsCents: 5000,
          currency: "KES",
          fromDueDate: "2026-04-01",
        },
        1
      ),
      env(
        {
          type: "arrears.accrued",
          occurredAt: "2026-05-15T00:00:00Z",
          leaseId: "l1",
          arrearsCents: 3000,
          currency: "KES",
          fromDueDate: "2026-04-15",
        },
        2
      ),
    ];

    const out = project<ArrearsState>(
      events,
      { totalArrearsCents: 0 },
      {
        "arrears.accrued": (state, ev: ArrearsAccrued) => ({
          totalArrearsCents: state.totalArrearsCents + ev.arrearsCents,
        }),
      }
    );

    expect(out.totalArrearsCents).toBe(8000);
  });

  it("ignores events with no reducer", () => {
    const events = [
      env(
        {
          type: "payment.initiated",
          occurredAt: "2026-05-01T00:00:00Z",
          leaseId: "l1",
          providerRef: "r",
          amountCents: 1000,
          currency: "KES",
          provider: "mpesa",
        },
        1
      ),
    ];
    const out = project<ArrearsState>(
      events,
      { totalArrearsCents: 0 },
      {
        "arrears.accrued": (s) => s,
      }
    );
    expect(out.totalArrearsCents).toBe(0);
  });

  it("rent.reconciled reducer can decrement arrears", () => {
    const events: EventEnvelope[] = [
      env(
        {
          type: "arrears.accrued",
          occurredAt: "2026-05-01T00:00:00Z",
          leaseId: "l1",
          arrearsCents: 5000,
          currency: "KES",
          fromDueDate: "2026-04-01",
        },
        1
      ),
      env(
        {
          type: "rent.reconciled",
          occurredAt: "2026-05-20T00:00:00Z",
          leaseId: "l1",
          paidCents: 5000,
          currency: "KES",
          remainingArrearsCents: 0,
        },
        2
      ),
    ];

    const out = project<ArrearsState>(
      events,
      { totalArrearsCents: 0 },
      {
        "arrears.accrued": (s, e: ArrearsAccrued) => ({
          totalArrearsCents: s.totalArrearsCents + e.arrearsCents,
        }),
        "rent.reconciled": (_s, e: RentReconciled) => ({
          totalArrearsCents: e.remainingArrearsCents,
        }),
      }
    );

    expect(out.totalArrearsCents).toBe(0);
  });

  it("envelope.version is passed to reducer", () => {
    let captured = -1;
    project<ArrearsState>(
      [
        env(
          {
            type: "rent.due.recorded",
            occurredAt: "2026-05-01",
            leaseId: "l1",
            amountCents: 1000,
            currency: "KES",
            dueDate: "2026-06-01",
          } satisfies RentDueRecorded,
          7
        ),
      ],
      { totalArrearsCents: 0 },
      {
        "rent.due.recorded": (s, _e, envelope) => {
          captured = envelope.version;
          return s;
        },
      }
    );
    expect(captured).toBe(7);
  });
});
