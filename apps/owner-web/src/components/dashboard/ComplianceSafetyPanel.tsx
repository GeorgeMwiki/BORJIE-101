'use client';

import { Card } from '@borjie/design-system';
import { useLocale, pickByLocale } from '@/lib/locale';
import type {
  LicenceHealthSlot,
  OpenHighIncidentsSlot,
} from '@/lib/queries/owner-brief';
import { dataAStrings as S } from '@/i18n/strings/data-a';

interface ComplianceSafetyPanelProps {
  readonly licenceHealth: LicenceHealthSlot;
  readonly incidents: OpenHighIncidentsSlot;
}

/**
 * Compliance + safety panel — bottom row of the dashboard.
 *
 * Two columns: licence health (per-mineral-right expiry / at-risk
 * indicators from the gateway) and the most recent high-severity
 * incidents (already merged into the alert queue, but repeated here
 * with the full kind/severity for the compliance officer's eye).
 *
 * Single-language per active locale: all chrome renders in the active
 * locale only. The header italic line previously hardcoded a Swahili
 * subtitle under an English title (EN/SW mixing); it now resolves from
 * the cockpit locale cookie like the rest of the panel.
 */
export function ComplianceSafetyPanel({
  licenceHealth,
  incidents,
}: ComplianceSafetyPanelProps): JSX.Element {
  const locale = useLocale();
  const C = S.complianceSafetyPanel;
  return (
    <section
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
      data-testid="dashboard-compliance-safety"
    >
      <Card hoverable className="flex flex-col gap-3 p-5">
        <header>
          <h2 className="cockpit-card-title">
            {pickByLocale(locale, C.licenceHealth)}
          </h2>
        </header>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-3xl text-foreground">
            {licenceHealth.totalCount}
          </span>
          <span className="text-sm text-neutral-400">
            {pickByLocale(locale, C.licencesTracked)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`pill ${
              licenceHealth.atRiskCount === 0 ? 'pill-green' : 'pill-amber'
            }`}
          >
            {licenceHealth.atRiskCount} {pickByLocale(locale, C.atRisk)}
          </span>
        </div>
        {licenceHealth.items.length === 0 ? (
          <p
            className="text-sm text-neutral-400"
            data-testid="dashboard-licence-empty"
          >
            {pickByLocale(locale, C.licenceEmpty)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {licenceHealth.items.slice(0, 5).map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3"
                data-testid="dashboard-licence-row"
              >
                <span
                  className={`pill shrink-0 ${
                    item.atRisk ? 'pill-red' : 'pill-green'
                  }`}
                >
                  {item.atRisk
                    ? pickByLocale(locale, C.rowAtRisk)
                    : pickByLocale(locale, C.rowOk)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm text-foreground">
                    {item.number ?? item.id}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {item.kind ?? pickByLocale(locale, C.mineralRight)} ·{' '}
                    {item.daysToExpiry === null
                      ? pickByLocale(locale, C.expiryUnknown)
                      : pickByLocale(locale, C.daysToExpiry(item.daysToExpiry))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card hoverable className="flex flex-col gap-3 p-5">
        <header>
          <h2 className="cockpit-card-title">
            {pickByLocale(locale, C.incidents)}
          </h2>
        </header>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-3xl text-foreground">
            {incidents.count}
          </span>
          <span className="text-sm text-neutral-400">
            {pickByLocale(locale, C.openLast7d)}
          </span>
        </div>
        {incidents.items.length === 0 ? (
          <p
            className="text-sm text-neutral-400"
            data-testid="dashboard-incident-empty"
          >
            {pickByLocale(locale, C.incidentEmptyBefore)}{' '}
            <a className="text-signal-500 underline" href="/">
              /
            </a>{' '}
            {pickByLocale(locale, C.incidentEmptyAfter)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {incidents.items.slice(0, 5).map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3"
                data-testid="dashboard-incident-row"
              >
                <span
                  className={`pill shrink-0 ${
                    item.severity === 'critical' || item.severity === 'high'
                      ? 'pill-red'
                      : 'pill-amber'
                  }`}
                >
                  {item.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm text-foreground">
                    {item.kind}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {item.occurredAt ?? pickByLocale(locale, C.timeUnknown)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
