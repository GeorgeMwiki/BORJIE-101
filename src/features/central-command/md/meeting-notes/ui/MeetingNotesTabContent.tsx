"use client";

/**
 * MeetingNotesTabContent — lazy-loaded Meeting Notes projection
 * (iter-30).
 *
 * Shows the last 50 meeting_notes rows for the caller's tenant.
 * Realtime patches as the MD records new 1on1s / team meetings from
 * chat.
 *
 * @module features/central-command/md/meeting-notes/ui/MeetingNotesTabContent
 */

import { useTenantIdentity } from "@/features/central-command/md/shared/useTenantIdentity";
import { useTenantRealtime } from "@/features/central-command/md/shared/useTenantRealtime";

interface MeetingNoteRow {
  readonly id: string;
  readonly employee_id: string | null;
  readonly meeting_kind:
    | "1on1"
    | "team"
    | "review"
    | "standup"
    | "ad_hoc"
    | "external";
  readonly meeting_at: string;
  readonly duration_min: number | null;
  readonly summary: string;
  readonly decisions: ReadonlyArray<string>;
  readonly action_items: ReadonlyArray<string>;
  readonly sentiment: "positive" | "neutral" | "concerning" | null;
}

function sentimentBadge(s: MeetingNoteRow["sentiment"]): string {
  switch (s) {
    case "positive":
      return "rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700";
    case "concerning":
      return "rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700";
    case "neutral":
      return "rounded bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-600";
    default:
      return "hidden";
  }
}

function formatMeetingAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function MeetingNotesTabContent(): React.JSX.Element {
  const { identity, error: identityError } = useTenantIdentity();
  const { rows, hasData, isLoading, loadError } =
    useTenantRealtime<MeetingNoteRow>({
      tenantId: identity?.tenantId ?? null,
      table: "meeting_notes",
      columns:
        "id, employee_id, meeting_kind, meeting_at, duration_min, summary, decisions, action_items, sentiment",
      orderColumn: "meeting_at",
      orderAscending: false,
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
        Loading meeting notes…
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
          No meeting notes yet
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Tell the MD about your meetings ({" "}
          <em>&ldquo;I just had a 1on1 with Asha&rdquo;</em>) and they show up
          here in real time.
        </p>
      </div>
    );
  }

  // Show last 50 to keep the page light on mobile.
  const visible = rows.slice(0, 50);

  return (
    <section
      aria-label="Meeting notes"
      data-testid="md-meeting-notes-tab"
      className="space-y-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-medium text-slate-800">
          Meeting notes ({rows.length}
          {rows.length > 50 ? ", showing latest 50" : ""})
        </h2>
        <p className="text-xs text-slate-500">Live · auto-updates from chat</p>
      </header>
      <ul className="space-y-2">
        {visible.map((row) => (
          <li
            key={row.id}
            data-testid={`md-meeting-note-row-${row.id}`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                {row.meeting_kind}
                {row.duration_min ? ` · ${row.duration_min} min` : ""}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                {row.sentiment ? (
                  <span className={sentimentBadge(row.sentiment)}>
                    {row.sentiment}
                  </span>
                ) : null}
                <p className="text-[11px] text-slate-500">
                  {formatMeetingAt(row.meeting_at)}
                </p>
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-800">{row.summary}</p>
            {row.action_items && row.action_items.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                {row.action_items.slice(0, 5).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
