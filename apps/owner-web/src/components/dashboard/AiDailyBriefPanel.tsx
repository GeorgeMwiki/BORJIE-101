import type { DailyBriefSlot } from '@/lib/queries/owner-brief';

interface AiDailyBriefPanelProps {
  readonly dailyBrief: DailyBriefSlot;
}

/**
 * AI daily brief panel — left column of the dashboard top row.
 *
 * Surfaces the four headline counters the cron computes for today:
 * shifts logged, open incidents, open grievances, critical incidents.
 * The header includes a Swahili gloss so bilingual owners see both.
 */
export function AiDailyBriefPanel({
  dailyBrief,
}: AiDailyBriefPanelProps): JSX.Element {
  const empty =
    dailyBrief.shiftsToday === 0 &&
    dailyBrief.openIncidents === 0 &&
    dailyBrief.openGrievances === 0 &&
    dailyBrief.criticalIncidents === 0;

  return (
    <article
      className="cockpit-card flex flex-col gap-4"
      data-testid="dashboard-daily-brief"
    >
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="cockpit-card-title">AI daily brief</h2>
          <p className="text-xs italic text-neutral-500">
            Muhtasari wa siku · {dailyBrief.date}
          </p>
        </div>
        {dailyBrief.criticalIncidents > 0 ? (
          <span className="pill pill-red">
            {dailyBrief.criticalIncidents} critical
          </span>
        ) : (
          <span className="pill pill-green">all clear</span>
        )}
      </header>

      {empty ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="dashboard-daily-brief-empty"
        >
          No activity logged yet today. Ask Borjie Brain on{' '}
          <a className="text-signal-500 underline" href="/">
            /
          </a>{' '}
          to refresh the field signal.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-4">
          <BriefMetric
            label="Shifts logged"
            labelSw="Zamu zilizoandikwa"
            value={dailyBrief.shiftsToday}
          />
          <BriefMetric
            label="Open incidents"
            labelSw="Matukio yaliyo wazi"
            value={dailyBrief.openIncidents}
            tone={dailyBrief.openIncidents > 0 ? 'amber' : 'neutral'}
          />
          <BriefMetric
            label="Open grievances"
            labelSw="Malalamiko yaliyo wazi"
            value={dailyBrief.openGrievances}
            tone={dailyBrief.openGrievances > 0 ? 'amber' : 'neutral'}
          />
          <BriefMetric
            label="Critical incidents"
            labelSw="Matukio mazito"
            value={dailyBrief.criticalIncidents}
            tone={dailyBrief.criticalIncidents > 0 ? 'red' : 'neutral'}
          />
        </dl>
      )}
    </article>
  );
}

interface BriefMetricProps {
  readonly label: string;
  readonly labelSw: string;
  readonly value: number;
  readonly tone?: 'neutral' | 'amber' | 'red';
}

function BriefMetric({
  label,
  labelSw,
  value,
  tone = 'neutral',
}: BriefMetricProps): JSX.Element {
  const valueClass =
    tone === 'red'
      ? 'text-destructive'
      : tone === 'amber'
        ? 'text-warning'
        : 'text-foreground';
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={`mt-1 font-display text-2xl ${valueClass}`}>{value}</dd>
      <p className="text-xs italic text-neutral-600">{labelSw}</p>
    </div>
  );
}
