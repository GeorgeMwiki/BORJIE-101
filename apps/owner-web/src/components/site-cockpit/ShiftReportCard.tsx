'use client';

import type { Blocker, ShiftReport } from '@/lib/types/site-cockpit';
import { StatusPill } from '@/components/shared/StatusPill';
import { fmtDateForLocale, fmtNum } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface ShiftReportCardProps {
  readonly latest: ShiftReport;
  readonly blockers: ReadonlyArray<Blocker>;
  readonly photos: ReadonlyArray<{ readonly id: string; readonly caption: string }>;
  readonly initialLocale?: Locale;
}

const SEVERITY_TO_TONE: Record<Blocker['severity'], 'green' | 'amber' | 'red'> = {
  low: 'green',
  medium: 'amber',
  high: 'red',
};

const SEVERITY_LEAF: Record<
  Blocker['severity'],
  { readonly en: string; readonly sw: string }
> = {
  low: S.shift.sevLow,
  medium: S.shift.sevMedium,
  high: S.shift.sevHigh,
};

export function ShiftReportCard({
  latest,
  blockers,
  photos,
  initialLocale,
}: ShiftReportCardProps) {
  const locale = useLocale(initialLocale);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <article className="rounded-md border border-border bg-surface px-4 py-4 lg:col-span-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {pickByLocale(locale, S.shift.latest)}
        </div>
        <div className="mt-1 text-base font-display text-foreground">
          {fmtDateForLocale(latest.date, locale)} · {latest.shift}{' '}
          {pickByLocale(locale, S.shift.shiftSuffix)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Stat
            label={pickByLocale(locale, S.shift.tonnesMined)}
            value={fmtNum(latest.tonnesMined)}
          />
          <Stat
            label={pickByLocale(locale, S.shift.headGrade)}
            value={`${latest.headGradeGpt.toFixed(2)} g/t`}
          />
          <Stat
            label={pickByLocale(locale, S.shift.grammes)}
            value={fmtNum(latest.grammesRecovered)}
          />
          <Stat
            label={pickByLocale(locale, S.shift.variance)}
            value={`${latest.varianceVsPlanPct > 0 ? '+' : ''}${latest.varianceVsPlanPct}%`}
          />
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {pickByLocale(locale, S.shift.supervisor(latest.supervisor))}
        </div>
        <p className="mt-2 text-xs italic text-muted-foreground">{latest.notes}</p>
      </article>
      <article className="rounded-md border border-border bg-surface px-4 py-4 lg:col-span-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {pickByLocale(locale, S.shift.blockers(blockers.length))}
        </div>
        <ul className="mt-2 space-y-2 text-sm">
          {blockers.map((b) => (
            <li key={b.id} className="flex items-start gap-2">
              <StatusPill
                tone={SEVERITY_TO_TONE[b.severity]}
                label={pickByLocale(locale, SEVERITY_LEAF[b.severity])}
              />
              <div>
                <div className="text-foreground">{b.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {pickByLocale(locale, S.shift.blockerOwner(b.owner))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </article>
      <article className="rounded-md border border-border bg-surface px-4 py-4 lg:col-span-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {pickByLocale(locale, S.shift.photos(photos.length))}
        </div>
        {photos.length === 0 ? (
          <p className="mt-2 text-tiny italic text-muted-foreground">
            {pickByLocale(locale, S.shift.photosEmpty)}
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {photos.map((p) => (
              <div
                key={p.id}
                className="flex aspect-square flex-col justify-end rounded-md border border-border bg-background p-2 text-tiny text-muted-foreground"
              >
                {p.caption}
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <div className="text-tiny uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-display text-foreground">{value}</div>
    </div>
  );
}
