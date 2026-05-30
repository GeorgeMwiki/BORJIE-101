/**
 * Tests — concrete EmployeesReader. Uses a fake Supabase that responds
 * to md_employees + md_employee_feedback_turns with deterministic rows.
 */

import { describe, expect, it } from "vitest";

import { makeEmployeesReader } from "../employees-reader-impl";

const ORG = "11111111-1111-1111-1111-111111111111";
const ALICE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BOB_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOW = new Date("2026-05-18T00:00:00Z");

interface FakeRow {
  [k: string]: unknown;
}

function makeFakeSupabase(rows: Record<string, ReadonlyArray<FakeRow>>) {
  function chain(rowsForTable: ReadonlyArray<FakeRow>) {
    const builder = {
      eq() {
        return builder;
      },
      gte() {
        return builder;
      },
      is() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return Promise.resolve({ data: rowsForTable, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: rowsForTable, error: null }).then(
          resolve,
        );
      },
    };
    return builder;
  }
  return {
    from(table: string) {
      const t = rows[table] ?? [];
      return {
        select() {
          return chain(t);
        },
      };
    },
  };
}

describe("makeEmployeesReader", () => {
  it("returns [] when there are no employees", async () => {
    const supabase = makeFakeSupabase({ md_employees: [] });
    const reader = makeEmployeesReader({ supabase, now: () => NOW });
    const out = await reader(ORG);
    expect(out).toEqual([]);
  });

  it("returns one signal per employee with staleness computed", async () => {
    const supabase = makeFakeSupabase({
      md_employees: [
        {
          id: ALICE_ID,
          tenant_id: ORG,
          name: "Alice",
          role: "Engineer",
          hire_date: "2025-01-01T00:00:00Z",
          last_1_on_1_at: "2026-04-01T00:00:00Z", // 47 days ago
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          id: BOB_ID,
          tenant_id: ORG,
          name: "Bob",
          role: "Designer",
          hire_date: "2025-09-01T00:00:00Z",
          last_1_on_1_at: null, // falls back to hireDate
          created_at: "2025-09-01T00:00:00Z",
        },
      ],
      md_employee_feedback_turns: [],
    });
    const reader = makeEmployeesReader({ supabase, now: () => NOW });
    const out = await reader(ORG);
    expect(out.length).toBe(2);
    const alice = out.find((s) => s.employeeId === ALICE_ID)!;
    const bob = out.find((s) => s.employeeId === BOB_ID)!;
    expect(alice.name).toBe("Alice");
    expect(alice.daysSinceLastOneOnOne).toBeGreaterThanOrEqual(46);
    expect(alice.daysSinceLastOneOnOne).toBeLessThanOrEqual(48);
    expect(bob.daysSinceLastOneOnOne).toBeGreaterThan(200);
    expect(alice.riskScore).toBeGreaterThanOrEqual(0);
    expect(alice.riskScore).toBeLessThanOrEqual(1);
  });

  it("aggregates negative sentiment from feedback turns into riskScore", async () => {
    const supabase = makeFakeSupabase({
      md_employees: [
        {
          id: ALICE_ID,
          tenant_id: ORG,
          name: "Alice",
          role: "Engineer",
          hire_date: "2025-01-01T00:00:00Z",
          last_1_on_1_at: "2026-04-01T00:00:00Z",
          created_at: "2025-01-01T00:00:00Z",
        },
      ],
      md_employee_feedback_turns: [
        {
          turn_id: "t1",
          tenant_id: ORG,
          text: "Alice has been late again and missed her deadline",
          recorded_at: "2026-05-10T09:00:00Z",
        },
        {
          turn_id: "t2",
          tenant_id: ORG,
          text: "Concerned about Alice's recent performance issues",
          recorded_at: "2026-05-12T09:00:00Z",
        },
      ],
    });
    const reader = makeEmployeesReader({ supabase, now: () => NOW });
    const out = await reader(ORG);
    expect(out.length).toBe(1);
    expect(out[0]!.recentSentiment).toBe("negative");
    expect(out[0]!.riskScore).toBeGreaterThan(0.3);
  });

  it("survives a Supabase-throw on employees table", async () => {
    const broken = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      limit() {
                        return Promise.reject(new Error("network"));
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const reader = makeEmployeesReader({ supabase: broken, now: () => NOW });
    const out = await reader(ORG);
    expect(out).toEqual([]);
  });
});
