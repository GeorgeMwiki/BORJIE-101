"use client";

/**
 * TasksTabContent — lazy-loaded Tasks projection.
 *
 * Iter-29 Phase B continuation of the lazy + realtime pattern proven
 * in the Employees tab. Reads from `org_tasks` (iter-28 migration)
 * and updates LIVE when the MD calls `schedule_task` from chat.
 *
 * @module features/central-command/md/tasks/ui/TasksTabContent
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useTasksRealtime, type TaskRow } from "./useTasksRealtime";

interface Identity {
  readonly tenantId: string;
  readonly userId: string;
}

function formatDue(iso: string | null): string {
  if (!iso) return "(no due date)";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function priorityBadge(p: TaskRow["priority"]): string {
  switch (p) {
    case "urgent":
      return "rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700";
    case "high":
      return "rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800";
    case "low":
      return "rounded bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500";
    case "normal":
    default:
      return "rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600";
  }
}

function statusBadge(s: TaskRow["status"]): string {
  switch (s) {
    case "in_progress":
      return "rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700";
    case "blocked":
      return "rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700";
    case "open":
    default:
      return "rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700";
  }
}

export default function TasksTabContent(): React.JSX.Element {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (error) {
          setIdentityError(error.message);
          return;
        }
        if (!user) {
          setIdentityError("Not signed in.");
          return;
        }
        const md = (user.user_metadata ?? {}) as Record<string, unknown>;
        const tenantId =
          (typeof md.org_id === "string" && md.org_id) ||
          (typeof md.bank_id === "string" && md.bank_id) ||
          null;
        if (!tenantId) {
          setIdentityError(
            "No org_id / bank_id on profile — operator metadata missing.",
          );
          return;
        }
        setIdentity({ tenantId, userId: user.id });
      } catch (err) {
        if (!cancelled) {
          setIdentityError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { tasks, hasData, isLoading, loadError } = useTasksRealtime(
    identity?.tenantId ?? null,
  );

  if (identityError) {
    return (
      <div
        role="alert"
        className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        {identityError}
      </div>
    );
  }
  if (!identity || isLoading) {
    return (
      <div
        role="status"
        className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
      >
        Loading tasks…
      </div>
    );
  }
  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        {loadError}
      </div>
    );
  }
  if (!hasData) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h2 className="text-base font-medium text-slate-800">
          No active tasks
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Open the MD chat and say something like{" "}
          <em>&ldquo;remind Asha to file the Q3 report by Friday&rdquo;</em>.
          The Tasks tab will update automatically.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Tasks"
      data-testid="md-tasks-tab"
      className="space-y-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-medium text-slate-800">
          Active tasks ({tasks.length})
        </h2>
        <p className="text-xs text-slate-500">Live · auto-updates from chat</p>
      </header>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {tasks.map((row) => (
          <li
            key={row.id}
            data-testid={`md-task-row-${row.id}`}
            className="px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{row.title}</p>
              <div className="flex shrink-0 items-center gap-1">
                <span className={statusBadge(row.status)}>{row.status}</span>
                <span className={priorityBadge(row.priority)}>
                  {row.priority}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Due {formatDue(row.due_at)}
            </p>
            {row.description ? (
              <p className="mt-1 text-xs text-slate-600">{row.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
