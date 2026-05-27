import type {
  LicenceHealthSlot,
  OpenHighIncidentsSlot,
} from '@/lib/queries/owner-brief';

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
 */
export function ComplianceSafetyPanel({
  licenceHealth,
  incidents,
}: ComplianceSafetyPanelProps): JSX.Element {
  return (
    <section
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
      data-testid="dashboard-compliance-safety"
    >
      <article className="cockpit-card flex flex-col gap-3">
        <header>
          <h2 className="cockpit-card-title">Licence health</h2>
          <p className="text-xs italic text-neutral-500">Afya ya leseni</p>
        </header>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-3xl text-foreground">
            {licenceHealth.totalCount}
          </span>
          <span className="text-sm text-neutral-400">licences tracked</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`pill ${
              licenceHealth.atRiskCount === 0 ? 'pill-green' : 'pill-amber'
            }`}
          >
            {licenceHealth.atRiskCount} at risk
          </span>
        </div>
        {licenceHealth.items.length === 0 ? (
          <p
            className="text-sm text-neutral-400"
            data-testid="dashboard-licence-empty"
          >
            No licence rows resolved yet. The licence cockpit will populate
            once the registrar feed reconciles for your tenant.
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
                  {item.atRisk ? 'at risk' : 'ok'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm text-foreground">
                    {item.number ?? item.id}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {item.kind ?? 'mineral right'} ·{' '}
                    {item.daysToExpiry === null
                      ? 'expiry unknown'
                      : `${item.daysToExpiry}d to expiry`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="cockpit-card flex flex-col gap-3">
        <header>
          <h2 className="cockpit-card-title">High-severity incidents</h2>
          <p className="text-xs italic text-neutral-500">Matukio mazito</p>
        </header>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-3xl text-foreground">
            {incidents.count}
          </span>
          <span className="text-sm text-neutral-400">open · last 7d</span>
        </div>
        {incidents.items.length === 0 ? (
          <p
            className="text-sm text-neutral-400"
            data-testid="dashboard-incident-empty"
          >
            No open high-severity incidents. Ask Borjie Brain on{' '}
            <a className="text-signal-500 underline" href="/">
              /
            </a>{' '}
            for the long-tail safety scan if you want a second pass.
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
                    {item.occurredAt ?? 'time unknown'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
