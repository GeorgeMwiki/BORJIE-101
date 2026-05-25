import { Sparkline } from '../Sparkline';

interface SloCardProps {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly sparkline?: ReadonlyArray<number>;
  readonly tone?: 'neutral' | 'warn' | 'danger';
}

const TONE_CLASS: Record<NonNullable<SloCardProps['tone']>, string> = {
  neutral: 'border-border bg-surface',
  warn: 'border-warning/40 bg-warning-subtle/20',
  danger: 'border-danger/40 bg-danger/5',
};

export function SloCard({ label, value, hint, sparkline, tone = 'neutral' }: SloCardProps): JSX.Element {
  return (
    <div className={`rounded-lg border p-4 ${TONE_CLASS[tone]}`}>
      <p className="text-[0.62rem] uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="text-2xl font-display text-foreground tabular-nums mt-1">{value}</p>
      {hint ? <p className="text-xs text-neutral-500 mt-1">{hint}</p> : null}
      {sparkline ? (
        <div className="mt-2">
          <Sparkline values={sparkline} width={180} height={30} label={`${label} trend`} />
        </div>
      ) : null}
    </div>
  );
}
