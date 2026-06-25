'use client';

import { Card } from '@borjie/design-system';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type {
  DecisionsSlot,
  OpenHighIncidentsSlot,
} from '@/lib/queries/owner-brief';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import { tailStrings as T } from '@/i18n/strings/tail';

interface AlertQueuePanelProps {
  readonly decisions: DecisionsSlot;
  readonly incidents: OpenHighIncidentsSlot;
  /** Server-resolved locale — seeds the hook so the first paint matches SSR. */
  readonly initialLocale?: Locale | undefined;
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
 * Localize the raw `severity` token to the active locale. Reuses the
 * canonical incident-severity map (shared with the safety + people
 * surfaces) so the same token never renders two different ways. Unknown
 * values fall back to a localized placeholder, never the raw English
 * enum token (zero-mix canon).
 */
function severityLabel(severity: string, locale: Locale): string {
  const map = T.incident.severity;
  const leaf = map[severity.toLowerCase() as keyof typeof map] ?? map.unknown;
  return pickByLocale(locale, leaf);
}

/** Localize the raw `kind` token through the canonical incident-kind map. */
function kindLabel(kind: string, locale: Locale): string {
  const map = T.incident.kind;
  const leaf = map[kind.toLowerCase() as keyof typeof map] ?? map.unknown;
  return pickByLocale(locale, leaf);
}

/**
 * Alert queue panel — right column of the dashboard top row.
 *
 * Merges the pending-decisions slot and the open high-severity
 * incidents slot into a single chronological queue capped at 8 rows.
 * Each row carries its severity pill and source kind so the operator
 * can triage at a glance without leaving the dashboard.
 *
 * Single-language per active locale: every string resolves from the
 * cockpit locale cookie (seeded by `initialLocale`). Raw severity /
 * source / kind enum tokens map through localized label tables — the
 * wire stays locale-neutral, the FE localizes.
 */
export function AlertQueuePanel({
  decisions,
  incidents,
  initialLocale,
}: AlertQueuePanelProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const rows = mergeAlerts(decisions, incidents, locale);
  const A = S.alertQueuePanel;

  return (
    <Card
      hoverable
      className="flex flex-col gap-4 p-5"
      data-testid="dashboard-alert-queue"
    >
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="cockpit-card-title">{pickByLocale(locale, A.title)}</h2>
          <p className="text-xs italic text-neutral-500">
            {pickByLocale(locale, A.subtitle)}
          </p>
        </div>
        <span className="pill border-border text-neutral-400">
          {pickByLocale(locale, A.openCount(rows.length))}
        </span>
      </header>

      {rows.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="dashboard-alert-queue-empty"
        >
          {pickByLocale(locale, A.empty.before)}{' '}
          <a className="text-signal-500 underline" href="/">
            /
          </a>{' '}
          {pickByLocale(locale, A.empty.after)}
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
                {severityLabel(row.severity, locale)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm text-foreground">
                  {row.title}
                </div>
                <div className="text-xs text-neutral-500">
                  {pickByLocale(locale, A.source[row.source])} ·{' '}
                  {kindLabel(row.kind, locale)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function mergeAlerts(
  decisions: DecisionsSlot,
  incidents: OpenHighIncidentsSlot,
  locale: Locale,
): ReadonlyArray<AlertRow> {
  const decisionRows: ReadonlyArray<AlertRow> = decisions.items.map((d) => ({
    id: d.id,
    // ZERO-MIX: `d.summary` is now a locale-neutral incident-kind TOKEN
    // (the gateway no longer emits the free-form `description` prose). Map
    // it through the canonical incident-kind table so the title is always
    // in the active locale — never a raw enum or unknown-language string.
    title: kindLabel(d.summary, locale),
    severity: d.severity ?? 'medium',
    kind: d.kind,
    source: 'decision' as const,
  }));
  const incidentRows: ReadonlyArray<AlertRow> = incidents.items.map((i) => ({
    id: i.id,
    // Localize the raw kind/severity tokens so the title stays in the
    // active locale — never a raw English enum inside a Swahili surface.
    title: `${kindLabel(i.kind, locale)} (${severityLabel(i.severity, locale)})`,
    severity: i.severity,
    kind: i.kind,
    source: 'incident' as const,
  }));
  return [...incidentRows, ...decisionRows].slice(0, 8);
}
