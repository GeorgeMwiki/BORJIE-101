'use client';

import { Card } from '@borjie/design-system';
import { useLocale, pickByLocale } from '@/lib/locale';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import type { DailyBriefSlot } from '@/lib/queries/owner-brief';

interface AiDailyBriefPanelProps {
  readonly dailyBrief: DailyBriefSlot;
}

/**
 * AI daily brief panel — left column of the dashboard top row.
 *
 * Surfaces the four headline counters the cron computes for today:
 * shifts logged, open incidents, open grievances, critical incidents.
 *
 * Single-language per active locale: every label renders ONLY in the
 * active locale. The previous design rendered an English label with a
 * Swahili gloss stacked underneath (EN/SW mixing) — that has been
 * collapsed to one language resolved from the cockpit locale cookie.
 */
export function AiDailyBriefPanel({
  dailyBrief,
}: AiDailyBriefPanelProps): JSX.Element {
  const locale = useLocale();
  const empty =
    dailyBrief.shiftsToday === 0 &&
    dailyBrief.openIncidents === 0 &&
    dailyBrief.openGrievances === 0 &&
    dailyBrief.criticalIncidents === 0;

  return (
    <Card
      hoverable
      className="flex flex-col gap-4 p-5"
      data-testid="dashboard-daily-brief"
    >
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="cockpit-card-title">
            {pickByLocale(locale, S.aiDailyBrief.title)}
          </h2>
          <p className="text-xs italic text-neutral-500">
            {pickByLocale(locale, S.aiDailyBrief.subtitle)} · {dailyBrief.date}
          </p>
        </div>
        {dailyBrief.criticalIncidents > 0 ? (
          <span className="pill pill-red">
            {pickByLocale(
              locale,
              S.aiDailyBrief.critical(dailyBrief.criticalIncidents),
            )}
          </span>
        ) : (
          <span className="pill pill-green">
            {pickByLocale(locale, S.aiDailyBrief.allClear)}
          </span>
        )}
      </header>

      {empty ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="dashboard-daily-brief-empty"
        >
          {pickByLocale(locale, S.aiDailyBrief.emptyBefore)}{' '}
          <a className="text-signal-500 underline" href="/">
            /
          </a>{' '}
          {pickByLocale(locale, S.aiDailyBrief.emptyAfter)}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-4">
          <BriefMetric
            label={pickByLocale(locale, S.aiDailyBrief.shiftsLogged)}
            value={dailyBrief.shiftsToday}
          />
          <BriefMetric
            label={pickByLocale(locale, S.aiDailyBrief.openIncidents)}
            value={dailyBrief.openIncidents}
            tone={dailyBrief.openIncidents > 0 ? 'amber' : 'neutral'}
          />
          <BriefMetric
            label={pickByLocale(locale, S.aiDailyBrief.openGrievances)}
            value={dailyBrief.openGrievances}
            tone={dailyBrief.openGrievances > 0 ? 'amber' : 'neutral'}
          />
          <BriefMetric
            label={pickByLocale(locale, S.aiDailyBrief.criticalIncidents)}
            value={dailyBrief.criticalIncidents}
            tone={dailyBrief.criticalIncidents > 0 ? 'red' : 'neutral'}
          />
        </dl>
      )}
    </Card>
  );
}

interface BriefMetricProps {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'neutral' | 'amber' | 'red';
}

function BriefMetric({
  label,
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
    </div>
  );
}
