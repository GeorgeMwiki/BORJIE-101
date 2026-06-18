import { Card } from '@borjie/design-system';

interface ComplianceCardProps {
  readonly green: number;
  readonly amber: number;
  readonly red: number;
}

export function ComplianceCard({ green, amber, red }: ComplianceCardProps) {
  const total = green + amber + red;
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">Compliance status</div>
      <div className="cockpit-card-value">{total}</div>
      <div className="cockpit-card-meta">obligations tracked</div>
      <div className="mt-3 flex gap-1.5">
        <span className="pill pill-green">{green} green</span>
        <span className="pill pill-amber">{amber} amber</span>
        <span className="pill pill-red">{red} red</span>
      </div>
    </Card>
  );
}
