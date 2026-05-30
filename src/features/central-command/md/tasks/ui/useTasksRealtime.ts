"use client";

/**
 * useTasksRealtime — live projection of org_tasks for the Tasks tab.
 *
 * iter-29 Phase B: tabs are projections. Owner says
 * "remind Asha to file Q3 by Friday" → MD calls schedule_task →
 * org_tasks row lands → supabase realtime fires → this hook patches
 * local state → the tab renders the new task LIVE.
 *
 * NO MOCK DATA. NO HARDCODED FALLBACKS:
 *   - Empty tenant returns hasData:false — the UI shows an honest
 *     "no tasks yet — chat with the MD" empty state.
 *   - Errors surface verbatim so the operator sees the gap.
 *
 * @module features/central-command/md/tasks/ui/useTasksRealtime
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly assigned_to: string | null;
  readonly status: "open" | "in_progress" | "blocked" | "done" | "cancelled";
  readonly priority: "low" | "normal" | "high" | "urgent";
  readonly due_at: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface UseTasksRealtimeResult {
  readonly tasks: ReadonlyArray<TaskRow>;
  readonly hasData: boolean;
  readonly isLoading: boolean;
  readonly loadError: string | null;
}

export function useTasksRealtime(
  tenantId: string | null,
): UseTasksRealtimeResult {
  const [tasks, setTasks] = useState<ReadonlyArray<TaskRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setIsLoading(false);
      setLoadError("Sign in to view the Tasks tab.");
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("org_tasks")
        .select(
          "id, title, description, assigned_to, status, priority, due_at, completed_at, created_at, updated_at",
        )
        .eq("tenant_id", tenantId)
        .in("status", ["open", "in_progress", "blocked"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setLoadError(`tasks query failed: ${error.message}`);
        setIsLoading(false);
        return;
      }
      setTasks((data ?? []) as ReadonlyArray<TaskRow>);
      setIsLoading(false);
    })();

    const channel = supabase
      .channel(`org_tasks:${tenantId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "org_tasks",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: TaskRow;
          old: TaskRow;
        }) => {
          setTasks((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== payload.old.id);
            }
            if (payload.eventType === "INSERT") {
              if (prev.some((r) => r.id === payload.new.id)) return prev;
              // Only show active tasks in the live view.
              if (
                payload.new.status === "done" ||
                payload.new.status === "cancelled"
              ) {
                return prev;
              }
              return [payload.new, ...prev];
            }
            // UPDATE: drop completed / cancelled tasks; patch otherwise.
            if (
              payload.new.status === "done" ||
              payload.new.status === "cancelled"
            ) {
              return prev.filter((r) => r.id !== payload.new.id);
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
  }, [tenantId]);

  return {
    tasks,
    hasData: tasks.length > 0,
    isLoading,
    loadError,
  };
}
