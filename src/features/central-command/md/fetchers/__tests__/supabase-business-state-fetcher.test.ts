/**
 * Tests for the SupabaseBusinessStateFetcher.
 *
 * Coverage:
 *   - Maps customers/employees/leads/suppliers/finance/compliance/learning
 *     rows into the BusinessSnapshot shape with sensible defaults.
 *   - Defensive on null / missing columns.
 *   - Snapshot is deep-frozen.
 *   - A slow query (over the timeout) yields [] for that section
 *     without blocking the rest.
 *   - generatedAt uses the injected clock.
 */

import { describe, it, expect } from "vitest";

import { makeSupabaseBusinessStateFetcher } from "../supabase-business-state-fetcher";

interface ChainSpec {
  readonly rows: ReadonlyArray<unknown> | null;
  readonly delayMs?: number;
  readonly throws?: boolean;
}

function makeFakeSupabase(byTable: Record<string, ChainSpec>) {
  return {
    from(table: string) {
      const spec: ChainSpec = byTable[table] ?? { rows: [] };
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        then<T>(resolve: (value: { data: unknown[] | null }) => T) {
          if (spec.throws) {
            throw new Error("supabase_threw_for_" + table);
          }
          const data: unknown[] | null =
            spec.rows === null ? null : [...spec.rows];
          if (spec.delayMs && spec.delayMs > 0) {
            return new Promise<T>((res) =>
              setTimeout(() => res(resolve({ data })), spec.delayMs),
            );
          }
          return resolve({ data });
        },
      };
      return chain;
    },
  };
}

describe("supabaseBusinessStateFetcher — mappers", () => {
  it("maps all 7 sections + uses the injected clock", async () => {
    const FIXED = new Date("2026-05-18T12:00:00Z");
    const supabase = makeFakeSupabase({
      customers: {
        rows: [
          {
            id: "c-1",
            name: "Acme",
            nps_score: 30,
            csat_score: 4.5,
            last_contact_at: "2026-05-01T00:00:00Z",
            open_complaints: 1,
            arr_usd: 150_000,
          },
        ],
      },
      employees: {
        rows: [
          {
            id: "e-1",
            name: "Aisha",
            last_1on1_at: "2026-04-20T00:00:00Z",
            engagement_score: 7.2,
            is_new_hire: false,
            role_start_at: "2024-01-01T00:00:00Z",
          },
        ],
      },
      leads: {
        rows: [
          {
            id: "l-1",
            stage: "qualified",
            stage_entered_at: "2026-05-10T00:00:00Z",
            value_usd: 25_000,
            probability: 0.45,
          },
        ],
      },
      suppliers: {
        rows: [
          {
            id: "s-1",
            name: "Cloudy",
            contract_expires_at: "2026-09-01T00:00:00Z",
            criticality: "high",
            annual_spend_usd: 80_000,
          },
        ],
      },
      org_finance_snapshot: {
        rows: [
          {
            cash_usd: 500_000,
            monthly_burn_usd: 60_000,
            overdue_invoices_count: 2,
            overdue_amount_usd: 12_000,
          },
        ],
      },
      compliance_obligations: {
        rows: [
          {
            id: "o-1",
            description: "BoT Q2 filing",
            due_at: "2026-06-30T00:00:00Z",
            status: "in-progress",
          },
        ],
      },
      employee_training_progress: {
        rows: [
          {
            employee_id: "e-1",
            track_name: "AML refresher",
            completion_percent: 65,
          },
        ],
      },
    });

    const fetcher = makeSupabaseBusinessStateFetcher(supabase, {
      now: () => FIXED,
    });
    const snap = await fetcher.fetch("org-1");
    expect(snap.orgId).toBe("org-1");
    expect(snap.generatedAt).toBe(FIXED.toISOString());
    expect(snap.customers).toHaveLength(1);
    expect(snap.customers[0].name).toBe("Acme");
    expect(snap.customers[0].arrUsd).toBe(150_000);
    expect(snap.employees[0].name).toBe("Aisha");
    expect(snap.employees[0].engagementScore).toBe(7.2);
    expect(snap.pipeline[0].stage).toBe("qualified");
    expect(snap.pipeline[0].probability).toBe(0.45);
    expect(snap.suppliers[0].criticality).toBe("high");
    expect(snap.finance.cashUsd).toBe(500_000);
    expect(snap.finance.overdueInvoicesCount).toBe(2);
    expect(snap.compliance[0].status).toBe("in-progress");
    expect(snap.learning[0].completionPercent).toBe(65);
  });

  it("clamps probability into [0,1] and tolerates string numbers", async () => {
    const supabase = makeFakeSupabase({
      leads: {
        rows: [
          {
            id: "l-1",
            stage: "X",
            stage_entered_at: null,
            value_usd: "30000",
            probability: "0.95",
          },
        ],
      },
    });
    const fetcher = makeSupabaseBusinessStateFetcher(supabase);
    const snap = await fetcher.fetch("org-1");
    expect(snap.pipeline[0].valueUsd).toBe(30_000);
    expect(snap.pipeline[0].probability).toBeCloseTo(0.95);
  });

  it("falls back to zeros/empty when columns missing", async () => {
    const supabase = makeFakeSupabase({
      customers: { rows: [{ id: "c-1" }] },
      employees: { rows: [] },
      org_finance_snapshot: { rows: [] },
    });
    const fetcher = makeSupabaseBusinessStateFetcher(supabase);
    const snap = await fetcher.fetch("org-1");
    expect(snap.customers[0].name).toBe("(unnamed)");
    expect(snap.customers[0].openComplaints).toBe(0);
    expect(snap.finance.cashUsd).toBe(0);
    expect(snap.employees).toHaveLength(0);
  });

  it("normalizes invalid criticality/status to safe defaults", async () => {
    const supabase = makeFakeSupabase({
      suppliers: {
        rows: [
          {
            id: "s-1",
            name: "X",
            criticality: "extreme",
          },
        ],
      },
      compliance_obligations: {
        rows: [
          {
            id: "o-1",
            description: "X",
            status: "purgatory",
          },
        ],
      },
    });
    const fetcher = makeSupabaseBusinessStateFetcher(supabase);
    const snap = await fetcher.fetch("org-1");
    expect(snap.suppliers[0].criticality).toBe("medium");
    expect(snap.compliance[0].status).toBe("open");
  });

  it("clamps a slow query at the per-table timeout (returns [])", async () => {
    const supabase = makeFakeSupabase({
      customers: {
        rows: [{ id: "c-1", name: "Slow Inc" }],
        delayMs: 200,
      },
      employees: { rows: [] },
    });
    const fetcher = makeSupabaseBusinessStateFetcher(supabase, {
      queryTimeoutMs: 50,
    });
    const snap = await fetcher.fetch("org-1");
    expect(snap.customers).toHaveLength(0);
    expect(snap.employees).toHaveLength(0);
  });

  it("returns deep-frozen output (snapshot.customers cannot be mutated)", async () => {
    const supabase = makeFakeSupabase({
      customers: { rows: [{ id: "c-1", name: "A" }] },
    });
    const fetcher = makeSupabaseBusinessStateFetcher(supabase);
    const snap = await fetcher.fetch("org-1");
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.customers)).toBe(true);
    expect(Object.isFrozen(snap.customers[0])).toBe(true);
  });
});
