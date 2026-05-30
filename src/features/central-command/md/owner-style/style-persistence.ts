/**
 * Persistence — Supabase upsert / fetch of OwnerStyleProfile rows.
 *
 * The table is owner_style_profiles (tenant_id, owner_user_id, profile_json,
 * updated_at). RLS pins reads/writes to `auth.uid() = owner_user_id`. The
 * service-role client is used for cross-owner admin operations.
 */

import { z } from "zod";
import { createLogger } from "@/lib/logger";
import {
  OwnerStyleProfileSchema,
  makeDefaultProfile,
  type OwnerStyleProfile,
} from "./style-dimensions";

const log = createLogger("md.owner-style");

// ---------------------------------------------------------------------------
// Storage contract — injectable so tests don't need a live Supabase.
// ---------------------------------------------------------------------------

export interface ProfileStore {
  fetch(args: {
    readonly tenantId: string;
    readonly ownerUserId: string;
  }): Promise<OwnerStyleProfile | null>;
  upsert(profile: OwnerStyleProfile): Promise<OwnerStyleProfile>;
}

// ---------------------------------------------------------------------------
// In-memory store — for tests and the default factory fallback.
// ---------------------------------------------------------------------------

export function createInMemoryProfileStore(): ProfileStore {
  const map = new Map<string, OwnerStyleProfile>();
  const keyOf = (t: string, u: string) => `${t}::${u}`;

  return {
    async fetch({ tenantId, ownerUserId }) {
      return map.get(keyOf(tenantId, ownerUserId)) ?? null;
    },
    async upsert(profile) {
      const parsed = OwnerStyleProfileSchema.safeParse(profile);
      if (!parsed.success) {
        log.warn("invalid profile rejected at upsert", {
          error: parsed.error.message,
        });
        throw new Error("invalid OwnerStyleProfile");
      }
      const snapshot: OwnerStyleProfile = { ...parsed.data };
      map.set(keyOf(profile.tenantId, profile.ownerUserId), snapshot);
      return snapshot;
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase-backed store — only built when called from server context.
// Lazy import so the module is safe to import in the test environment.
// ---------------------------------------------------------------------------

const RowSchema = z.object({
  tenant_id: z.string(),
  owner_user_id: z.string(),
  profile_json: z.unknown(),
  updated_at: z.string(),
});

export interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(
        col: string,
        val: string,
      ): {
        eq(
          col: string,
          val: string,
        ): {
          maybeSingle(): Promise<{
            data: unknown;
            error: { message: string } | null;
          }>;
        };
      };
    };
    upsert(
      row: Record<string, unknown>,
      opts?: { onConflict?: string },
    ): {
      select(cols: string): {
        single(): Promise<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export function createSupabaseProfileStore(client: SupabaseLike): ProfileStore {
  return {
    async fetch({ tenantId, ownerUserId }) {
      const { data, error } = await client
        .from("owner_style_profiles")
        .select("tenant_id, owner_user_id, profile_json, updated_at")
        .eq("tenant_id", tenantId)
        .eq("owner_user_id", ownerUserId)
        .maybeSingle();
      if (error) {
        log.error("supabase fetch failed", { error: error.message });
        return null;
      }
      if (!data) return null;
      const row = RowSchema.safeParse(data);
      if (!row.success) {
        log.warn("malformed row", { error: row.error.message });
        return null;
      }
      const profile = OwnerStyleProfileSchema.safeParse(row.data.profile_json);
      if (!profile.success) {
        log.warn("malformed profile JSON", { error: profile.error.message });
        return null;
      }
      return profile.data;
    },

    async upsert(profile) {
      const parsed = OwnerStyleProfileSchema.safeParse(profile);
      if (!parsed.success) {
        log.warn("invalid profile rejected at upsert", {
          error: parsed.error.message,
        });
        throw new Error("invalid OwnerStyleProfile");
      }
      const row = {
        tenant_id: parsed.data.tenantId,
        owner_user_id: parsed.data.ownerUserId,
        profile_json: parsed.data,
        updated_at: parsed.data.lastUpdatedAt,
      };
      const { data, error } = await client
        .from("owner_style_profiles")
        .upsert(row, { onConflict: "tenant_id,owner_user_id" })
        .select("tenant_id, owner_user_id, profile_json, updated_at")
        .single();
      if (error) {
        log.error("supabase upsert failed", { error: error.message });
        throw new Error(`upsert failed: ${error.message}`);
      }
      const out = OwnerStyleProfileSchema.safeParse(
        (data as { profile_json?: unknown } | null)?.profile_json,
      );
      if (!out.success) {
        // Echo back the validated input we just persisted
        return parsed.data;
      }
      return out.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: fetch-or-default.
// ---------------------------------------------------------------------------

export async function fetchOrDefault(
  store: ProfileStore,
  args: { readonly tenantId: string; readonly ownerUserId: string },
): Promise<OwnerStyleProfile> {
  const existing = await store.fetch(args);
  if (existing) return existing;
  return makeDefaultProfile(args);
}
