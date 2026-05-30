"use client";

/**
 * useTenantRealtime — generic tenant-scoped supabase realtime hook.
 *
 * Extracts the iter-28/29 hand-rolled pattern (initial-load query +
 * postgres_changes subscription + INSERT/UPDATE/DELETE patch) into
 * one parametrised hook. KPIs / Escalations / Meeting-Notes tabs all
 * call this with their own table + columns.
 *
 * NO MOCK DATA contract preserved:
 *   - Empty result → hasData:false → tab shows honest "no rows yet"
 *   - Query error → loadError surfaces real message
 *   - When tenantId null (signed-out) → returns immediately with
 *     "Sign in" instruction, never queries.
 *
 * @module features/central-command/md/shared/useTenantRealtime
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface BaseRow {
  readonly id: string;
}

export interface UseTenantRealtimeOptions<TRow extends BaseRow> {
  readonly tenantId: string | null;
  readonly table: string;
  readonly columns: string;
  /**
   * Optional `.in("status", [...])` filter for initial query. Realtime
   * patches still flow for ALL rows in the tenant; the consumer's
   * row-filter callback applies in-memory.
   */
  readonly initialStatusIn?: ReadonlyArray<string>;
  readonly orderColumn?: string;
  readonly orderAscending?: boolean;
  /** Drop incoming rows that the consumer considers terminal. */
  readonly shouldDropOnUpdate?: (row: TRow) => boolean;
  /** Drop INSERTs that the consumer considers out-of-view (e.g. done). */
  readonly shouldDropOnInsert?: (row: TRow) => boolean;
}

export interface UseTenantRealtimeResult<TRow extends BaseRow> {
  readonly rows: ReadonlyArray<TRow>;
  readonly hasData: boolean;
  readonly isLoading: boolean;
  readonly loadError: string | null;
}

export function useTenantRealtime<TRow extends BaseRow>(
  opts: UseTenantRealtimeOptions<TRow>,
): UseTenantRealtimeResult<TRow> {
  const [rows, setRows] = useState<ReadonlyArray<TRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dropOnInsertRef = useRef(opts.shouldDropOnInsert);
  const dropOnUpdateRef = useRef(opts.shouldDropOnUpdate);
  dropOnInsertRef.current = opts.shouldDropOnInsert;
  dropOnUpdateRef.current = opts.shouldDropOnUpdate;

  const {
    tenantId,
    table,
    columns,
    initialStatusIn,
    orderColumn = "created_at",
    orderAscending = false,
  } = opts;

  useEffect(() => {
    if (!tenantId) {
      setIsLoading(false);
      setLoadError("Sign in to view this tab.");
      return;
    }
    let cancelled = false;

    (async () => {
      let q = supabase
        .from(table)
        .select(columns)
        .eq("tenant_id", tenantId)
        .order(orderColumn, { ascending: orderAscending, nullsFirst: false });
      if (initialStatusIn && initialStatusIn.length > 0) {
        q = q.in("status", initialStatusIn);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        setLoadError(`${table} query failed: ${error.message}`);
        setIsLoading(false);
        return;
      }
      setRows((data ?? []) as unknown as ReadonlyArray<TRow>);
      setIsLoading(false);
    })();

    const channel = supabase
      .channel(`${table}:${tenantId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table,
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: TRow;
          old: TRow;
        }) => {
          setRows((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== payload.old.id);
            }
            if (payload.eventType === "INSERT") {
              if (prev.some((r) => r.id === payload.new.id)) return prev;
              if (dropOnInsertRef.current?.(payload.new)) return prev;
              return [payload.new, ...prev];
            }
            // UPDATE
            if (dropOnUpdateRef.current?.(payload.new)) {
              return prev.filter((r) => r.id !== payload.new.id);
            }
            const exists = prev.some((r) => r.id === payload.new.id);
            if (!exists) {
              if (dropOnInsertRef.current?.(payload.new)) return prev;
              return [payload.new, ...prev];
            }
            return prev.map((r) => (r.id === payload.new.id ? payload.new : r));
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [tenantId, table, columns, orderColumn, orderAscending, initialStatusIn]);

  return {
    rows,
    hasData: rows.length > 0,
    isLoading,
    loadError,
  };
}
