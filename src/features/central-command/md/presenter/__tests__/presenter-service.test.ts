/**
 * Presenter Service — end-to-end pipeline with an injected fake
 * Supabase factory. Validates that `processOwnerTurn` resolves the
 * full pipeline and produces a Zod-valid spec, while finalising a
 * DecisionTrace.
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { InMemoryTraceStore } from "@/core/borjie-ai/decision-trace";
import { parseGenerativeUiSpec } from "@/core/brain/generative-ui/types";

import { processOwnerTurn, setPresenterTraceStore } from "../presenter-service";
import { setSupabaseFactory } from "../data-fetcher";
import type { PresenterContext } from "../types";

// ---------------------------------------------------------------------------
// Fake Supabase
// ---------------------------------------------------------------------------

type Row = Readonly<Record<string, unknown>>;

interface FakeTable {
  readonly rows: ReadonlyArray<Row>;
}

function makeFakeSupabase(tables: Record<string, FakeTable>): SupabaseClient {
  function chain(initial: ReadonlyArray<Row>) {
    let rows: ReadonlyArray<Row> = initial;
    const api = {
      select: () => api,
      eq: (col: string, value: unknown) => {
        rows = rows.filter((r) => r[col] === value);
        return api;
      },
      filter: (col: string, _op: string, value: unknown) => {
        rows = rows.filter((r) => r[col] === value);
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (
        resolve: (v: { data: ReadonlyArray<Row>; error: null }) => unknown,
      ) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return api;
  }
  return {
    from: (name: string) => chain(tables[name]?.rows ?? []),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: "https://signed.test/doc" },
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const CTX: PresenterContext = {
  userId: "owner-1",
  tenantId: "tenant-1",
  tier: "borjie-admin",
  correlationId: "corr-1",
  sessionId: "session-1",
};

beforeEach(() => {
  setPresenterTraceStore(new InMemoryTraceStore());
});

describe("processOwnerTurn — happy paths", () => {
  it("resolves 'show me the team' → table spec", async () => {
    setSupabaseFactory(async () =>
      makeFakeSupabase({
        md_employees: {
          rows: [
            {
              id: "u1",
              name: "Asha",
              role: "Engineer",
              department: "engineering",
              last_one_on_one_at: "2026-04-30",
              sentiment: "positive",
              status: "active",
              tenant_id: "tenant-1",
            },
          ],
        },
      }),
    );
    const out = await processOwnerTurn("show me the team", CTX);
    expect(out).not.toBeNull();
    expect(out?.spec.kind).toBe("table");
    expect(() => parseGenerativeUiSpec(out!.spec)).not.toThrow();
    expect(out?.traceId).toMatch(/[0-9a-f-]{36}/);
  });

  it("resolves 'how are sales trending' → chart spec", async () => {
    setSupabaseFactory(async () =>
      makeFakeSupabase({
        md_sales_daily: {
          rows: [
            { day: "2026-01-01", revenue_tzs: 100, tenant_id: "tenant-1" },
            { day: "2026-01-02", revenue_tzs: 120, tenant_id: "tenant-1" },
          ],
        },
      }),
    );
    const out = await processOwnerTurn("how are sales trending", CTX);
    expect(out).not.toBeNull();
    expect(out?.spec.kind).toBe("chart.recharts.timeseries");
  });

  it("resolves 'show the supplier contract' → file preview markdown", async () => {
    setSupabaseFactory(async () =>
      makeFakeSupabase({
        md_contracts: {
          rows: [
            {
              storage_path: "contracts/acme.pdf",
              mime_type: "application/pdf",
              display_name: "Acme Supplier Agreement.pdf",
              kind: "supplier",
              tenant_id: "tenant-1",
            },
          ],
        },
      }),
    );
    const out = await processOwnerTurn("show the supplier contract", CTX);
    expect(out).not.toBeNull();
    expect(out?.spec.kind).toBe("markdown");
  });

  it("resolves 'show the org chart' → mermaid spec", async () => {
    setSupabaseFactory(async () =>
      makeFakeSupabase({
        md_employees: {
          rows: [
            {
              id: "u1",
              name: "Asha",
              role: "CEO",
              manager_id: null,
              status: "active",
              tenant_id: "tenant-1",
            },
            {
              id: "u2",
              name: "Ben",
              role: "COO",
              manager_id: "u1",
              status: "active",
              tenant_id: "tenant-1",
            },
          ],
        },
      }),
    );
    const out = await processOwnerTurn("show the org chart", CTX);
    expect(out).not.toBeNull();
    expect(out?.spec.kind).toBe("mermaid");
  });

  it("resolves 'show the KPIs' → metric grid spec", async () => {
    setSupabaseFactory(async () =>
      makeFakeSupabase({
        md_kpis: {
          rows: [
            { label: "MRR", value: 12_000, unit: "TZS", tenant_id: "tenant-1" },
            { label: "Customers", value: 42, tenant_id: "tenant-1" },
          ],
        },
      }),
    );
    const out = await processOwnerTurn("show the KPIs", CTX);
    expect(out).not.toBeNull();
    expect(out?.spec.kind).toBe("metric.grid");
  });
});

describe("processOwnerTurn — null path", () => {
  it("returns null for non-data turns", async () => {
    const out = await processOwnerTurn("hello there", CTX);
    expect(out).toBeNull();
  });
});

describe("processOwnerTurn — DecisionTrace", () => {
  it("persists a trace via the injected store", async () => {
    const store = new InMemoryTraceStore();
    setPresenterTraceStore(store);
    setSupabaseFactory(async () =>
      makeFakeSupabase({ md_employees: { rows: [] } }),
    );
    const out = await processOwnerTurn("show me the team", CTX);
    expect(out).not.toBeNull();
    const trace = await store.load(out!.traceId);
    expect(trace).not.toBeNull();
    expect(trace?.finalAction.type).toBe("presenter.render");
    expect(trace?.tier).toBe("borjie-admin");
  });
});
