"use client";

/**
 * EscalationsTabContent — lazy-loaded Escalations projection (iter-30).
 *
 * Shows open/acknowledged/in_progress org_escalations for the
 * caller's tenant, sorted by severity then recency. Realtime updates
 * as the MD raises new escalations or operators acknowledge them.
 *
 * @module features/central-command/md/escalations/ui/EscalationsTabContent
 */

import { useTenantIdentity } from "@/features/central-command/md/shared/useTenantIdentity";
import { useTenantRealtime } from "@/features/central-command/md/shared/useTenantRealtime";

interface EscalationRow {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
  readonly severity: "low" | "normal" | "high" | "critical";
  readonly status:
    | "open"
    | "acknowledged"
    | "in_progress"
    | "resolved"
    | "cancelled";
  readonly escalated_to_employee_id: string | null;
  readonly related_task_id: string | null;
  readonly related_subject: string | null;
  readonly created_at: string;
  readonly acknowledged_at: string | null;
}

function severityBadge(s: EscalationRow["severity"]): string {
  switch (s) {
    case "critical":
      return "rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800";
    case "high":
      return "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800";
    case "low":
      return "rounded bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500";
    case "normal":
    default:
      return "rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600";
  }
}

function statusBadge(s: EscalationRow["status"]): string {
  switch (s) {
    case "acknowledged":
      return "rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700";
    case "in_progress":
      return "rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700";
    case "open":
    default:
      return "rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700";
  }
}

function formatAge(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 24 * 60 * 60_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function EscalationsTabContent(): React.JSX.Element {
  const { identity, error: identityError } = useTenantIdentity();
  const { rows, hasData, isLoading, loadError } =
    useTenantRealtime<EscalationRow>({
      tenantId: identity?.tenantId ?? null,
      table: "org_escalations",
      columns:
        "id, title, reason, severity, status, escalated_to_employee_id, related_task_id, related_subject, created_at, acknowledged_at",
      initialStatusIn: ["open", "acknowledged", "in_progress"],
      orderColumn: "created_at",
      orderAscending: false,
      shouldDropOnInsert: (r) =>
        r.status === "resolved" || r.status === "cancelled",
      shouldDropOnUpdate: (r) =>
        r.status === "resolved" || r.status === "cancelled",
    });

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
        Loading escalations…
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
          No open escalations
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          When the MD raises something to a human (compliance, owner attention),
          it appears here in real time.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Escalations"
      data-testid="md-escalations-tab"
      className="space-y-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-medium text-slate-800">
          Open escalations ({rows.length})
        </h2>
        <p className="text-xs text-slate-500">Live · auto-updates from chat</p>
      </header>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid={`md-escalation-row-${row.id}`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{row.title}</p>
              <div className="flex shrink-0 items-center gap-1">
                <span className={severityBadge(row.severity)}>
                  {row.severity}
                </span>
                <span className={statusBadge(row.status)}>{row.status}</span>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-600">{row.reason}</p>
            {row.related_subject ? (
              <p className="mt-1 text-[11px] text-slate-500">
                Re: {row.related_subject}
              </p>
            ) : null}
            <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">
              Opened {formatAge(row.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
