import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

export interface MetricTile {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly icon?: LucideIcon;
  readonly delta?: {
    readonly value: string;
    readonly direction: 'up' | 'down' | 'flat';
    readonly tone?: 'positive' | 'negative' | 'neutral';
  };
  readonly tone?: 'default' | 'warning' | 'success' | 'danger';
}

interface MetricStripProps {
  readonly tiles: ReadonlyArray<MetricTile>;
  readonly cols?: 2 | 3 | 4;
}

/**
 * LitFin-rhythm metric strip — institutional KPI tiles.
 *
 * Used across every dashboard page (licences, royalties, treasury,
 * compliance, safety, marketplace). Each tile renders an eyebrow
 * label, a big display number, an optional sub-line, an optional
 * icon affordance, and an optional delta chip with direction arrow.
 *
 * Cols default to 4; pages that want a tighter grid can drop to 3 or
 * 2. Each tile maintains its own colour token to keep the strip
 * visually quiet when most metrics are neutral and immediately
 * obvious when one slot is in alarm.
 */
export function MetricStrip({ tiles, cols = 4 }: MetricStripProps) {
  const gridCols =
    cols === 2 ? 'lg:grid-cols-2' : cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${gridCols}`}>
      {tiles.map((tile, index) => (
        <Tile key={`${tile.label}-${index}`} {...tile} />
      ))}
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon, delta, tone = 'default' }: MetricTile) {
  const borderTone =
    tone === 'warning'
      ? 'border-warning/40'
      : tone === 'success'
        ? 'border-success/40'
        : tone === 'danger'
          ? 'border-destructive/40'
          : 'border-border';

  const iconTone =
    tone === 'warning'
      ? 'bg-warning/10 text-warning'
      : tone === 'success'
        ? 'bg-success/10 text-success'
        : tone === 'danger'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-signal-500/10 text-signal-500';

  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-2xl border ${borderTone} bg-surface/40 p-5`}
    >
      <div className="min-w-0 space-y-1">
        <p className="text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500">
          {label}
        </p>
        <p className="font-display text-3xl text-foreground">{value}</p>
        {sub ? <p className="text-xs text-neutral-400">{sub}</p> : null}
        {delta ? <DeltaChip {...delta} /> : null}
      </div>
      {Icon ? (
        <div className={`shrink-0 rounded-xl p-2.5 ${iconTone}`}>
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
    </div>
  );
}

interface DeltaChipProps {
  readonly value: string;
  readonly direction: 'up' | 'down' | 'flat';
  readonly tone?: 'positive' | 'negative' | 'neutral';
}

function DeltaChip({ value, direction, tone = 'neutral' }: DeltaChipProps) {
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const cls =
    tone === 'positive'
      ? 'text-success'
      : tone === 'negative'
        ? 'text-destructive'
        : 'text-neutral-400';
  return (
    <span className={`mt-2 inline-flex items-center gap-1 text-badge font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}
