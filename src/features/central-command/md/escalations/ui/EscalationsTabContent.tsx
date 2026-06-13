"use client";

/**
 * EscalationsTabContent — the human-closing surface for the
 * manager-dispatch escalation ladder.
 *
 * SLICE B1 unification: this tab now reads the AUTHORITATIVE
 * `mining_escalations` table (the never-drop ladder rung-4 dispatcher
 * and the `/api/v1/mining/escalations` route both write it) through the
 * mounted gateway GET — replacing the previous `org_escalations`
 * Supabase subscription that the ladder never touched. It also wires
 * the Acknowledge / Resolve closing calls (`POST /:id/acknowledge`,
 * `/:id/resolve`) that previously had ZERO frontend callers, making the
 * CLOSING stage of the escalation flow reachable for the first time.
 *
 * Single language per render (en default · sw toggle); no en/sw mixing.
 * `org_escalations` consolidation is tracked as a follow-up — its rows
 * still exist and are still written; this slice does not delete data.
 *
 * @module features/central-command/md/escalations/ui/EscalationsTabContent
 */

import { useEscalations } from "./useEscalations";
import {
  escalationsCopy,
  type EscalationsLocale,
} from "./escalations-copy";
import {
  formatAge,
  severityBadge,
  statusBadge,
} from "./escalations-presentation";
import type { MiningEscalationRow } from "./escalations-client";

export interface EscalationsTabContentProps {
  /** Active UI locale; single-language render. Defaults to `en`. */
  readonly locale?: EscalationsLocale;
  /**
   * When false the tab does not query (e.g. signed-out / no tenant
   * resolved yet). Defaults to true; the gateway enforces tenant scope.
   */
  readonly enabled?: boolean;
}

function Banner(props: {
  readonly tone: "error" | "status";
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const cls =
    props.tone === "error"
      ? "rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      : "rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600";
  return (
    <div role={props.tone === "error" ? "alert" : "status"} className={cls}>
      {props.children}
    </div>
  );
}

export default function EscalationsTabContent({
  locale = "en",
  enabled = true,
}: EscalationsTabContentProps): React.JSX.Element {
  const copy = escalationsCopy(locale);
  const {
    rows,
    isLoading,
    loadError,
    actionError,
    pendingId,
    pendingAction,
    act,
  } = useEscalations(enabled);

  if (!enabled) return <Banner tone="status">{copy.signInRequired}</Banner>;
  if (isLoading) return <Banner tone="status">{copy.loading}</Banner>;
  if (loadError) return <Banner tone="error">{copy.loadFailed}</Banner>;
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h2 className="text-base font-medium text-slate-800">
          {copy.emptyTitle}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{copy.emptyBody}</p>
      </div>
    );
  }

  return (
    <section
      aria-label={copy.headerOpen(rows.length)}
      data-testid="md-escalations-tab"
      className="space-y-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-medium text-slate-800">
          {copy.headerOpen(rows.length)}
        </h2>
        <p className="text-xs text-slate-500">{copy.liveHint}</p>
      </header>
      {actionError ? (
        <Banner tone="error">{copy.actionFailed}</Banner>
      ) : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <EscalationListItem
            key={row.id}
            row={row}
            copy={copy}
            busy={pendingId === row.id}
            busyAction={pendingId === row.id ? pendingAction : null}
            anyPending={pendingId !== null}
            onAct={act}
          />
        ))}
      </ul>
    </section>
  );
}

function EscalationListItem(props: {
  readonly row: MiningEscalationRow;
  readonly copy: ReturnType<typeof escalationsCopy>;
  readonly busy: boolean;
  readonly busyAction: "acknowledge" | "resolve" | null;
  readonly anyPending: boolean;
  readonly onAct: (id: string, action: "acknowledge" | "resolve") => void;
}): React.JSX.Element {
  const { row, copy, busy, busyAction, anyPending, onAct } = props;
  const ackLabel = busyAction === "acknowledge" ? copy.acknowledging : copy.acknowledge;
  const resolveLabel = busyAction === "resolve" ? copy.resolving : copy.resolve;
  return (
    <li
      data-testid={`md-escalation-row-${row.id}`}
      className="rounded-lg border border-slate-200 bg-white px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{row.contextSw}</p>
        <div className="flex shrink-0 items-center gap-1">
          <span className={severityBadge(row.severity)}>
            {copy.severity[row.severity]}
          </span>
          <span className={statusBadge(row.status)}>
            {copy.status[row.status]}
          </span>
        </div>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">
        {copy.openedPrefix} {formatAge(row.createdAt, copy)}
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        {row.status === "open" ? (
          <button
            type="button"
            disabled={anyPending}
            onClick={() => onAct(row.id, "acknowledge")}
            className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 disabled:opacity-50"
          >
            {ackLabel}
          </button>
        ) : null}
        <button
          type="button"
          disabled={anyPending}
          onClick={() => onAct(row.id, "resolve")}
          className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50"
        >
          {resolveLabel}
        </button>
      </div>
      {busy ? <span className="sr-only">{copy.liveHint}</span> : null}
    </li>
  );
}
