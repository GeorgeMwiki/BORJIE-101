import type {
  DecisionsSlot,
  OpenHighIncidentsSlot,
} from '@/lib/queries/owner-brief';

interface AlertQueuePanelProps {
  readonly decisions: DecisionsSlot;
  readonly incidents: OpenHighIncidentsSlot;
}

interface AlertRow {
  readonly id: string;
  readonly title: string;
  readonly severity: string;
  readonly kind: string;
  readonly source: 'decision' | 'incident';
}

const SEVERITY_PILL: Record<string, string> = {
  critical: 'pill-red',
  high: 'pill-red',
  medium: 'pill-amber',
  low: 'pill-green',
};

/**
 * Alert queue panel — right column of the dashboard top row.
 *
 * Merges the pending-decisions slot and the open high-severity
 * incidents slot into a single chronological queue capped at 8 rows.
 * Each row carries its severity pill and source kind so the operator
 * can triage at a glance without leaving the dashboard.
 */
export function AlertQueuePanel({
  decisions,
  incidents,
}: AlertQueuePanelProps): JSX.Element {
  const rows = mergeAlerts(decisions, incidents);

  return (
    <article
      className="cockpit-card flex flex-col gap-4"
      data-testid="dashboard-alert-queue"
    >
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="cockpit-card-title">Alert queue</h2>
          <p className="text-xs italic text-neutral-500">
            Maamuzi yanayosubiri · matukio mazito
          </p>
        </div>
        <span className="pill border-border text-neutral-400">
          {rows.length} open
        </span>
      </header>

      {rows.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="dashboard-alert-queue-empty"
        >
          No open decisions or high-severity incidents. Ask Borjie Brain on{' '}
          <a className="text-signal-500 underline" href="/">
            /
          </a>{' '}
          to scan the corpus for anything you might be missing.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={`${row.source}-${row.id}`}
              className="flex items-start gap-3"
              data-testid="dashboard-alert-row"
            >
              <span
                className={`pill ${SEVERITY_PILL[row.severity] ?? 'border-border text-neutral-400'} shrink-0`}
              >
                {row.severity}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm text-foreground">
                  {row.title}
                </div>
                <div className="text-xs text-neutral-500">
                  {row.source === 'incident' ? 'incident' : 'decision'} ·{' '}
                  {row.kind}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function mergeAlerts(
  decisions: DecisionsSlot,
  incidents: OpenHighIncidentsSlot,
): ReadonlyArray<AlertRow> {
  const decisionRows: ReadonlyArray<AlertRow> = decisions.items.map((d) => ({
    id: d.id,
    title: d.summary,
    severity: d.severity ?? 'medium',
    kind: d.kind,
    source: 'decision' as const,
  }));
  const incidentRows: ReadonlyArray<AlertRow> = incidents.items.map((i) => ({
    id: i.id,
    title: `${i.kind} (${i.severity})`,
    severity: i.severity,
    kind: i.kind,
    source: 'incident' as const,
  }));
  return [...incidentRows, ...decisionRows].slice(0, 8);
}
