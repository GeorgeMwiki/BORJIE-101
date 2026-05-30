"use client";

/**
 * useTenantIdentity — shared identity resolver for all MD projection
 * tabs.
 *
 * Extracted from Employees + Tasks tabs (iter-28/29) so the iter-30
 * KPIs / Escalations / Meeting-Notes tabs can reuse the same
 * supabase-auth-derived tenant lookup without duplicating boilerplate.
 *
 * Returns null tenantId until the auth check resolves — consumer hooks
 * pass null to their realtime queries which short-circuit gracefully.
 *
 * @module features/central-command/md/shared/useTenantIdentity
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export interface TenantIdentity {
  readonly tenantId: string;
  readonly userId: string;
}

export interface UseTenantIdentityResult {
  readonly identity: TenantIdentity | null;
  readonly error: string | null;
}

export function useTenantIdentity(): UseTenantIdentityResult {
  const [identity, setIdentity] = useState<TenantIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
          error: authErr,
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) {
          setError(authErr.message);
          return;
        }
        if (!user) {
          setError("Not signed in.");
          return;
        }
        const md = (user.user_metadata ?? {}) as Record<string, unknown>;
        const tenantId =
          (typeof md.org_id === "string" && md.org_id) ||
          (typeof md.bank_id === "string" && md.bank_id) ||
          null;
        if (!tenantId) {
          setError(
            "No org_id / bank_id on profile — operator metadata missing.",
          );
          return;
        }
        setIdentity({ tenantId, userId: user.id });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { identity, error };
}
