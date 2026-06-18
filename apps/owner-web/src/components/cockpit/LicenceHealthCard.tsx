import { Card } from '@borjie/design-system';

interface LicenceHealthCardProps {
  readonly active: number;
  readonly renewalsDue60d: number;
  readonly dormancyFlags: number;
}

export function LicenceHealthCard({
  active,
  renewalsDue60d,
  dormancyFlags,
}: LicenceHealthCardProps) {
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">Licence health</div>
      <div className="cockpit-card-value">{active}</div>
      <div className="cockpit-card-meta">active mineral rights</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="pill pill-amber">
          {renewalsDue60d} renewal{renewalsDue60d === 1 ? '' : 's'} &lt; 60d
        </span>
        {dormancyFlags > 0 ? (
          <span className="pill pill-red">{dormancyFlags} dormancy flag</span>
        ) : null}
      </div>
    </Card>
  );
}
