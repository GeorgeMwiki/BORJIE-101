import { describe, it, expect } from "vitest";
import {
  createInMemoryProfileStore,
  createSupabaseProfileStore,
  fetchOrDefault,
  type SupabaseLike,
} from "../style-persistence";
import { makeDefaultProfile } from "../style-dimensions";

const owner = {
  tenantId: "t-1",
  ownerUserId: "u-1",
  now: () => "2026-05-17T00:00:00.000Z",
};

describe("style-persistence — in-memory", () => {
  it("fetch returns null before any upsert", async () => {
    const store = createInMemoryProfileStore();
    const got = await store.fetch(owner);
    expect(got).toBeNull();
  });

  it("upsert + fetch returns the same profile", async () => {
    const store = createInMemoryProfileStore();
    const p = makeDefaultProfile(owner);
    await store.upsert(p);
    const got = await store.fetch(owner);
    expect(got?.ownerUserId).toBe(p.ownerUserId);
  });

  it("upsert rejects invalid profiles", async () => {
    const store = createInMemoryProfileStore();
    const bad = { ...makeDefaultProfile(owner), confidence: 2 };
    await expect(store.upsert(bad)).rejects.toThrow();
  });

  it("fetchOrDefault returns default if missing", async () => {
    const store = createInMemoryProfileStore();
    const got = await fetchOrDefault(store, owner);
    expect(got.sampleSize).toBe(0);
  });
});

// Lightweight fake-supabase test exercises the Supabase store contract.
describe("style-persistence — supabase adapter", () => {
  function makeFake(): { client: SupabaseLike; rows: Map<string, unknown> } {
    const rows = new Map<string, unknown>();
    const client: SupabaseLike = {
      from() {
        return {
          select() {
            return {
              eq(_c1: string, v1: string) {
                return {
                  eq(_c2: string, v2: string) {
                    return {
                      async maybeSingle() {
                        const row = rows.get(`${v1}::${v2}`);
                        return { data: row ?? null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          upsert(row: Record<string, unknown>) {
            const key = `${row.tenant_id as string}::${row.owner_user_id as string}`;
            rows.set(key, row);
            return {
              select() {
                return {
                  async single() {
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    return { client, rows };
  }

  it("upsert + fetch roundtrips a profile", async () => {
    const { client } = makeFake();
    const store = createSupabaseProfileStore(client);
    const profile = makeDefaultProfile(owner);
    const persisted = await store.upsert(profile);
    expect(persisted.ownerUserId).toBe("u-1");
    const fetched = await store.fetch(owner);
    expect(fetched?.ownerUserId).toBe("u-1");
  });
});
