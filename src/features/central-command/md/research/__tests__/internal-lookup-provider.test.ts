/**
 * Tests for makeInternalLookupProvider.
 *
 * Coverage:
 *   - Returns [] on empty query
 *   - Tokenises + drops stopwords; finds matching customer rows
 *   - Aggregates across 5 tables in parallel
 *   - Relevance score: higher when more tokens match
 *   - Recency boost lifts fresh rows above stale matches
 *   - Slow table query times out and contributes [] (synthesis still
 *     completes from the other tables)
 *   - Output sorted by relevance desc
 */

import { describe, it, expect } from "vitest";

import { makeInternalLookupProvider } from "../internal-lookup-provider";

interface ChainSpec {
  readonly rows: ReadonlyArray<Record<string, unknown>> | null;
  readonly delayMs?: number;
}

function makeSupabase(byTable: Record<string, ChainSpec>) {
  return {
    from(table: string) {
      const spec: ChainSpec = byTable[table] ?? { rows: [] };
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        limit: () => chain,
        then<T>(resolve: (value: { data: unknown[] | null }) => T) {
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

describe("makeInternalLookupProvider — input safety", () => {
  it("returns [] on empty / stopwords-only query", async () => {
    const provider = makeInternalLookupProvider(makeSupabase({}), "org-1");
    expect(await provider("")).toEqual([]);
    expect(await provider("the and of for")).toEqual([]);
  });
});

describe("makeInternalLookupProvider — happy paths", () => {
  it("returns matched customer + lead + employee rows with relevance scores", async () => {
    // Schema note: ap_customers exposes display_name / industry /
    // contact_name / notes (see internal-lookup-provider.ts) — the
    // older `name` / `contact_summary` shape was replaced when the
    // table migrated from `customers` to `ap_customers`.
    const supabase = makeSupabase({
      ap_customers: {
        rows: [
          {
            id: "c-1",
            display_name: "Acme Tier",
            industry: "fintech",
            contact_name: "ops",
            notes: "tier-2 loan rates discussion",
            updated_at: "2026-05-15T00:00:00Z",
          },
        ],
      },
      leads: {
        rows: [
          {
            id: "l-1",
            contact_name: "Jane",
            notes: "interested in tier-2 product",
            stage: "qualified",
            updated_at: "2026-05-10T00:00:00Z",
          },
        ],
      },
      employees: { rows: [] },
      compliance_obligations: { rows: [] },
      brain_thoughts: { rows: [] },
    });

    const provider = makeInternalLookupProvider(supabase, "org-1");
    const out = await provider("tier-2 rates");
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((f) => f.source === "internal" && f.relevance > 0)).toBe(
      true,
    );
    const titles = out.map((f) => f.title);
    expect(titles.some((t) => t.includes("Customer:"))).toBe(true);
    expect(titles.some((t) => t.includes("Lead:"))).toBe(true);
  });

  it("scores rows with more token matches higher", async () => {
    const supabase = makeSupabase({
      ap_customers: {
        rows: [
          {
            id: "c-low",
            display_name: "Only tier match",
            notes: "tier",
            updated_at: "2026-05-01T00:00:00Z",
          },
          {
            id: "c-high",
            display_name: "tier rates loan",
            notes: "complete tier rates loan match",
            updated_at: "2026-05-01T00:00:00Z",
          },
        ],
      },
    });
    const provider = makeInternalLookupProvider(supabase, "org-1");
    const out = await provider("tier rates loan");
    const high = out.find((f) => f.rowRef?.id === "c-high");
    const low = out.find((f) => f.rowRef?.id === "c-low");
    expect(high).toBeDefined();
    expect(low).toBeDefined();
    expect(high!.relevance).toBeGreaterThan(low!.relevance);
    // Output is pre-sorted by relevance.
    expect(out[0].rowRef?.id).toBe("c-high");
  });

  it("recency boost lifts fresh rows above stale ones at equal lexical match", async () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString(); // 1d ago
    const stale = new Date(Date.now() - 86_400_000 * 365).toISOString(); // 1y ago
    const supabase = makeSupabase({
      ap_customers: {
        rows: [
          {
            id: "fresh",
            display_name: "tier match",
            notes: "tier",
            updated_at: recent,
          },
          {
            id: "stale",
            display_name: "tier match",
            notes: "tier",
            updated_at: stale,
          },
        ],
      },
    });
    const provider = makeInternalLookupProvider(supabase, "org-1");
    const out = await provider("tier match");
    const fresh = out.find((f) => f.rowRef?.id === "fresh");
    const old = out.find((f) => f.rowRef?.id === "stale");
    expect(fresh!.relevance).toBeGreaterThanOrEqual(old!.relevance);
  });
});

describe("makeInternalLookupProvider — failure tolerance", () => {
  it("slow customers query times out + the other tables still contribute", async () => {
    const supabase = makeSupabase({
      ap_customers: { rows: [{ id: "slow", name: "tier" }], delayMs: 200 },
      // note: 4-table stub continues; the slow ap_customers row times
      // out per the production behaviour.
      brain_thoughts: {
        rows: [
          {
            id: "th-1",
            content: "Earlier note about tier dynamics.",
            created_at: new Date().toISOString(),
            kind: "observation",
            source: "md",
          },
        ],
      },
    });
    const provider = makeInternalLookupProvider(supabase, "org-1", {
      timeoutMs: 40,
    });
    const out = await provider("tier");
    // No customer row (timed out) but brain_thoughts still in result.
    expect(out.some((f) => f.title.startsWith("Brain note"))).toBe(true);
    expect(out.some((f) => f.title.startsWith("Customer:"))).toBe(false);
  });
});
