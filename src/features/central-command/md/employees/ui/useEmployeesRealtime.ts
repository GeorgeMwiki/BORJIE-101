"use client";

/**
 * useEmployeesRealtime — live projection hook for the Employees tab.
 *
 * Iter-28 Phase B: tabs are PROJECTIONS of what the MD has been told.
 * The owner says "add Asha as a credit officer" → MD calls
 * `create_employee_from_chat` → row lands in `employees` table →
 * supabase realtime fires → this hook updates → the tab renders the
 * new row WITHOUT a page reload.
 *
 * NO MOCK DATA. NO HARDCODED FALLBACKS:
 *   - When the table is empty for the tenant, returns `{ employees:
 *     [], hasData: false }`. The UI shows an honest "no employees on
 *     record yet — chat with the MD to add" empty state.
 *   - When the supabase client is unavailable (SSR, missing env),
 *     returns `{ employees: [], hasData: false, loadError: "..." }`
 *     with the actual error so the operator sees the configuration
 *     gap rather than thinking the org is empty.
 *
 * @module features/central-command/md/employees/ui/useEmployeesRealtime
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export interface EmployeeRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly hire_date: string;
  readonly manager: string | null;
  readonly sentiment: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface UseEmployeesRealtimeResult {
  readonly employees: ReadonlyArray<EmployeeRow>;
  readonly hasData: boolean;
  readonly isLoading: boolean;
  readonly loadError: string | null;
}

export function useEmployeesRealtime(
  tenantId: string | null,
): UseEmployeesRealtimeResult {
  const [employees, setEmployees] = useState<ReadonlyArray<EmployeeRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setIsLoading(false);
      setLoadError("Sign in to view the Employees tab.");
      return;
    }
    let cancelled = false;

    // ----- initial load --------------------------------------------------
    (async () => {
      const { data, error } = await supabase
        .from("employees")
        .select(
          "id, name, role, hire_date, manager, sentiment, metadata, created_at, updated_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setLoadError(`employees query failed: ${error.message}`);
        setIsLoading(false);
        return;
      }
      setEmployees((data ?? []) as ReadonlyArray<EmployeeRow>);
      setIsLoading(false);
    })();

    // ----- realtime subscription ----------------------------------------
    // The supabase client emits INSERT / UPDATE / DELETE events for
    // rows matching the filter. We patch local state per event rather
    // than re-querying — keeps the tab responsive under high write rates.
    const channel = supabase
      .channel(`employees:${tenantId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "employees",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: EmployeeRow;
          old: EmployeeRow;
        }) => {
          setEmployees((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== payload.old.id);
            }
            if (payload.eventType === "INSERT") {
              if (prev.some((r) => r.id === payload.new.id)) return prev;
              return [payload.new, ...prev];
            }
            // UPDATE
            return prev.map((r) => (r.id === payload.new.id ? payload.new : r));
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return {
    employees,
    hasData: employees.length > 0,
    isLoading,
    loadError,
  };
}
