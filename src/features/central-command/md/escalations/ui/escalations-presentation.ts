"use client";

/**
 * escalations-presentation — pure view helpers for the Escalations tab.
 *
 * No JSX, no state: badge class lookups + locale-aware relative-age
 * formatting. Kept separate so the component stays small and these are
 * trivially unit-testable.
 *
 * @module features/central-command/md/escalations/ui/escalations-presentation
 */

import type {
  EscalationSeverity,
  EscalationStatus,
} from "./escalations-client";
import type { EscalationsCopy } from "./escalations-copy";

export function severityBadge(s: EscalationSeverity): string {
  switch (s) {
    case "critical":
      return "rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800";
    case "warning":
      return "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800";
    case "info":
    default:
      return "rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600";
  }
}

export function statusBadge(s: EscalationStatus): string {
  switch (s) {
    case "acknowledged":
      return "rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700";
    case "resolved":
      return "rounded bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500";
    case "open":
    default:
      return "rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700";
  }
}

/** Locale-aware relative age; falls back to a localized date string. */
export function formatAge(iso: string, copy: EscalationsCopy): string {
  const parsed = new Date(iso).getTime();
  if (Number.isNaN(parsed)) return iso;
  const ms = Date.now() - parsed;
  if (ms < 60_000) return copy.justNow;
  if (ms < 60 * 60_000) return copy.minutesAgo(Math.round(ms / 60_000));
  if (ms < 24 * 60 * 60_000) return copy.hoursAgo(Math.round(ms / 3_600_000));
  return new Date(parsed).toLocaleDateString();
}
