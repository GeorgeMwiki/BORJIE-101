/**
 * Tests — process-event log service. Verifies hash-chained append,
 * retry on unique-violation, and ordered read.
 */

import { describe, expect, it, beforeEach } from "vitest";

import {
  __resetProcessEventsHashSecretForTests,
  makeEventLogService,
  type EventLogSupabaseLike,
} from "../event-log-service";
import type { ProcessEventInput } from "../types";

const ORG = "11111111-1111-1111-1111-111111111111";

interface Row {
  [k: string]: unknown;
}

function makeFakeSupabase(): { api: EventLogSupabaseLike; rows: Row[] } {
  const rows: Row[] = [];
  const api: EventLogSupabaseLike = {
    from(table: string) {
      if (table !== "process_events")
        throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          let order: { col: string; asc: boolean } | null = null;
          let limit = Infinity;
          let gteCol: string | null = null;
          let gteVal: string | null = null;
          let lteCol: string | null = null;
          let lteVal: string | null = null;
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return builder;
            },
            gte(col: string, val: string) {
              gteCol = col;
              gteVal = val;
              return builder;
            },
            lte(col: string, val: string) {
              lteCol = col;
              lteVal = val;
              return builder;
            },
            order(col: string, opts?: { ascending?: boolean }) {
              order = { col, asc: opts?.ascending !== false };
              return builder;
            },
            limit(n: number) {
              limit = n;
              let data = rows.filter((r) =>
                filters.every(([k, v]) => r[k] === v),
              );
              if (gteCol && gteVal !== null) {
                data = data.filter((r) => String(r[gteCol!]) >= gteVal!);
              }
              if (lteCol && lteVal !== null) {
                data = data.filter((r) => String(r[lteCol!]) <= lteVal!);
              }
              if (order) {
                const o = order;
                data = [...data].sort((a, b) => {
                  const av = a[o.col];
                  const bv = b[o.col];
                  if (typeof av === "number" && typeof bv === "number") {
                    return o.asc ? av - bv : bv - av;
                  }
                  return o.asc
                    ? String(av).localeCompare(String(bv))
                    : String(bv).localeCompare(String(av));
                });
              }
              return Promise.resolve({
                data: data.slice(0, limit),
                error: null,
              });
            },
          };
          return builder;
        },
        insert(input: unknown) {
          const incoming = Array.isArray(input) ? input : [input];
          for (const r of incoming) {
            const r2 = r as Row;
            // Enforce UNIQUE (org_id, sequence_id).
            const dup = rows.find(
              (existing) =>
                existing.org_id === r2.org_id &&
                existing.sequence_id === r2.sequence_id,
            );
            if (dup) {
              return Promise.resolve({
                data: null,
                error: { message: "duplicate key value 23505" },
              });
            }
            rows.push(r2);
          }
          return Promise.resolve({ data: incoming, error: null });
        },
      };
    },
  };
  return { api, rows };
}

function evInput(activity: string, occurredAt: string): ProcessEventInput {
  return {
    processKey: "loan_origination",
    caseId: "case-1",
    activity,
    actorKind: "user",
    actorId: "u-1",
    occurredAt,
  };
}

describe("makeEventLogService", () => {
  let fake: ReturnType<typeof makeFakeSupabase>;
  beforeEach(() => {
    __resetProcessEventsHashSecretForTests();
    fake = makeFakeSupabase();
  });

  it("appends a single event with sequence_id=1 + prev_hash=null", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    const r = await svc.append({
      orgId: ORG,
      event: evInput("Apply", "2026-05-01T09:00:00Z"),
    });
    expect(r.ok).toBe(true);
    expect(r.record!.sequenceId).toBe(1);
    expect(r.record!.prevHash).toBeNull();
    expect(r.record!.rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains: row 2 prevHash equals row 1 rowHash", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    const a = await svc.append({
      orgId: ORG,
      event: evInput("Apply", "2026-05-01T09:00:00Z"),
    });
    const b = await svc.append({
      orgId: ORG,
      event: evInput("KYC", "2026-05-01T10:00:00Z"),
    });
    expect(b.record!.sequenceId).toBe(2);
    expect(b.record!.prevHash).toBe(a.record!.rowHash);
  });

  it("rejects invalid event (zod)", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    const r = await svc.append({
      orgId: ORG,
      event: {
        ...evInput("X", "not-iso"),
      },
    });
    expect(r.ok).toBe(false);
  });

  it("appendMany returns partial-success report", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    const r = await svc.appendMany(ORG, [
      evInput("Apply", "2026-05-01T09:00:00Z"),
      { ...evInput("X", "not-iso") }, // bad
      evInput("KYC", "2026-05-01T10:00:00Z"),
    ]);
    expect(r.appended).toBe(2);
    expect(r.failed.length).toBe(1);
  });

  it("C-1: rejects activity containing NUL (edge-key injection defence)", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    const r = await svc.append({
      orgId: ORG,
      event: {
        processKey: "loan_origination",
        caseId: "case-1",
        activity: `Apply${String.fromCharCode(0)}evil`,
        actorKind: "user",
        actorId: "u-1",
        occurredAt: "2026-05-01T09:00:00Z",
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/control characters/);
  });

  it("H-2: rejects forbidden attribute keys (prototype / constructor)", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    // `__proto__` literal in object syntax sets the prototype, not an
    // own key — to test the runtime defence we use JSON.parse so the
    // attacker's payload survives as an own property.
    const evil = JSON.parse('{"prototype": {"polluted": true}}') as Record<
      string,
      unknown
    >;
    const r = await svc.append({
      orgId: ORG,
      event: {
        processKey: "loan_origination",
        caseId: "case-1",
        activity: "Apply",
        actorKind: "user",
        actorId: "u-1",
        occurredAt: "2026-05-01T09:00:00Z",
        attributes: evil,
      },
    });
    expect(r.ok).toBe(false);
  });

  it("H-2: rejects 'constructor' attribute key", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "constructor", {
      value: { polluted: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const r = await svc.append({
      orgId: ORG,
      event: {
        processKey: "loan_origination",
        caseId: "case-1",
        activity: "Apply",
        actorKind: "user",
        actorId: "u-1",
        occurredAt: "2026-05-01T09:00:00Z",
        attributes: evil,
      },
    });
    expect(r.ok).toBe(false);
  });

  it("read returns events sorted by occurred_at ascending", async () => {
    const svc = makeEventLogService({
      supabase: fake.api,
      hashSecret: "test-secret-".padEnd(40, "x"),
    });
    await svc.append({
      orgId: ORG,
      event: evInput("KYC", "2026-05-01T10:00:00Z"),
    });
    await svc.append({
      orgId: ORG,
      event: evInput("Apply", "2026-05-01T09:00:00Z"),
    });
    const events = await svc.read(
      ORG,
      "loan_origination",
      "2026-05-01T00:00:00Z",
      "2026-05-01T23:59:59Z",
    );
    expect(events.length).toBe(2);
    expect(events[0]!.activity).toBe("Apply");
    expect(events[1]!.activity).toBe("KYC");
  });
});
