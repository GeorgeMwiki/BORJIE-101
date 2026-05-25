import { describe, expect, it } from "vitest";
import {
  createDrizzleEventStore,
  type DBClient,
} from "../drizzle-store.js";
import { OptimisticConcurrencyError } from "../types.js";
import type { PaymentEvent } from "../events.js";

interface FakeRow {
  readonly stream_id: string;
  readonly version: number;
  readonly global_seq: number;
  readonly event_type: string;
  readonly payload: string;
  readonly recorded_at: Date;
}

/** Mimics minimum Postgres semantics needed by the adapter. */
function makeFakeDB(): { db: DBClient; rows: FakeRow[]; globalSeq: number } {
  const state = { rows: [] as FakeRow[], globalSeq: 0 };
  const db: DBClient = {
    async query<T = unknown>(sql: string, params: readonly unknown[] = []) {
      // Trim whitespace for easier matching.
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("SELECT COALESCE(MAX(version)")) {
        const [streamId] = params as [string];
        const v = state.rows
          .filter((r) => r.stream_id === streamId)
          .reduce((m, r) => Math.max(m, r.version), 0);
        return [{ max: v }] as unknown as T[];
      }
      if (s.startsWith("INSERT INTO")) {
        const [streamId, version, eventType, payload] = params as [
          string,
          number,
          string,
          string,
        ];
        const dup = state.rows.find(
          (r) => r.stream_id === streamId && r.version === version
        );
        if (dup) return [] as T[];
        state.globalSeq += 1;
        const row: FakeRow = {
          stream_id: streamId,
          version,
          global_seq: state.globalSeq,
          event_type: eventType,
          payload,
          recorded_at: new Date(),
        };
        state.rows.push(row);
        return [row] as unknown as T[];
      }
      if (s.startsWith("SELECT stream_id")) {
        const [streamId, fromVersion] = params as [string, number];
        return state.rows
          .filter(
            (r) => r.stream_id === streamId && r.version > fromVersion
          )
          .sort((a, b) => a.version - b.version) as unknown as T[];
      }
      throw new Error(`unmocked SQL: ${s}`);
    },
  };
  return { db, ...state, get rows() { return state.rows; }, get globalSeq() { return state.globalSeq; } };
}

function rentDue(leaseId: string): PaymentEvent {
  return {
    type: "rent.due.recorded",
    occurredAt: new Date().toISOString(),
    leaseId,
    amountCents: 50000,
    currency: "KES",
    dueDate: "2026-06-01",
  };
}

describe("createDrizzleEventStore", () => {
  it("appends to empty stream", async () => {
    const { db } = makeFakeDB();
    const store = createDrizzleEventStore({ db });
    const env = await store.append("lease:1", rentDue("l1"), 0);
    expect(env.version).toBe(1);
    expect(env.streamId).toBe("lease:1");
  });

  it("increments version on successive appends", async () => {
    const { db } = makeFakeDB();
    const store = createDrizzleEventStore({ db });
    await store.append("lease:1", rentDue("l1"), 0);
    const e2 = await store.append("lease:1", rentDue("l1"), 1);
    expect(e2.version).toBe(2);
  });

  it("throws OptimisticConcurrencyError on expected-version mismatch", async () => {
    const { db } = makeFakeDB();
    const store = createDrizzleEventStore({ db });
    await store.append("lease:1", rentDue("l1"), 0);
    await expect(
      store.append("lease:1", rentDue("l1"), 0)
    ).rejects.toBeInstanceOf(OptimisticConcurrencyError);
  });

  it("read returns envelopes ordered by version", async () => {
    const { db } = makeFakeDB();
    const store = createDrizzleEventStore({ db });
    await store.append("lease:1", rentDue("l1"), 0);
    await store.append("lease:1", rentDue("l1"), 1);
    const all = await store.read("lease:1");
    expect(all).toHaveLength(2);
    expect(all[0]?.version).toBe(1);
    expect(all[1]?.version).toBe(2);
  });

  it("read respects fromVersion", async () => {
    const { db } = makeFakeDB();
    const store = createDrizzleEventStore({ db });
    await store.append("lease:1", rentDue("l1"), 0);
    await store.append("lease:1", rentDue("l1"), 1);
    const slice = await store.read("lease:1", 1);
    expect(slice).toHaveLength(1);
    expect(slice[0]?.version).toBe(2);
  });

  it("subscribe returns a no-op unsubscribe (LISTEN/NOTIFY not wired)", () => {
    const { db } = makeFakeDB();
    const store = createDrizzleEventStore({ db });
    const unsub = store.subscribe({}, () => {});
    expect(typeof unsub).toBe("function");
    unsub(); // no-op
  });

  it("uses custom tableName when provided", async () => {
    let observedSQL = "";
    const db: DBClient = {
      async query(sql) {
        observedSQL = sql;
        return [{ max: 0 }];
      },
    };
    const store = createDrizzleEventStore({ db, tableName: "alt_events" });
    try {
      await store.append("lease:1", rentDue("l1"), 0);
    } catch {
      // expected — fake db does not implement insert.
    }
    expect(observedSQL).toContain("alt_events");
  });
});
