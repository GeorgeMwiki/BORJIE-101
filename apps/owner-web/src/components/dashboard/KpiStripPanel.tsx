'use client';

import { Sparkline } from '@/components/shared/Sparkline';
import { fmtNum, fmtTzsM } from '@/lib/format';
import type { OwnerBriefPayload } from '@/lib/queries/owner-brief';

interface KpiStripPanelProps {
  readonly brief: OwnerBriefPayload;
}

/**
 * KPI strip — five compact tiles per R1: production tonnes, cash days,
 * safety (open critical), licence health (% at risk), USD-cliff days.
 *
 * Each tile renders a recharts sparkline only when the underlying slot
 * has enough trend points to justify it — never fake bars. The
 * production sparkline reads per-site tonnes from the 30-day window.
 */
export function KpiStripPanel({ brief }: KpiStripPanelProps): JSX.Element {
  const productionTotal = brief.productionVsTarget.perSite.reduce(
    (sum, s) => sum + Number(s.tonnes ?? 0),
    0,
  );
  const cashDays = computeCashDays(brief.cashRunway);
  const safetyCount = brief.openHighIncidents.count;
  const licenceAtRiskPct = computeLicenceAtRiskPct(brief.licenceHealth);
  const cliffDays = computeCliffDaysAway(brief.cliffStatus.cliffDateIso);

  const productionSpark = brief.productionVsTarget.perSite.map((s, i) => ({
    x: s.siteId ?? `site-${i}`,
    y: Number(s.tonnes ?? 0),
  }));

  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
      data-testid="dashboard-kpi-strip"
    >
      <KpiTile
        label="Production · 30d"
        labelSw="Uzalishaji · siku 30"
        value={`${fmtNum(productionTotal)} t`}
        meta={`${brief.productionVsTarget.perSite.length} sites`}
        sparkData={productionSpark}
        tone="green"
        testId="kpi-production"
      />
      <KpiTile
        label="Cash · days"
        labelSw="Hela · siku zilizobaki"
        value={cashDays === null ? '—' : `${cashDays} d`}
        meta={fmtTzsM(brief.cashRunway.ninetyDayNetTzs / 1_000_000)}
        tone={
          cashDays === null
            ? 'amber'
            : cashDays >= 90
              ? 'green'
              : cashDays >= 45
                ? 'amber'
                : 'red'
        }
        testId="kpi-cash"
      />
      <KpiTile
        label="Safety · open critical"
        labelSw="Usalama · matukio mazito"
        value={fmtNum(safetyCount)}
        meta={`${brief.dailyBrief.criticalIncidents} critical today`}
        tone={safetyCount === 0 ? 'green' : safetyCount < 3 ? 'amber' : 'red'}
        testId="kpi-safety"
      />
      <KpiTile
        label="Licences · at risk"
        labelSw="Leseni · zenye hatari"
        value={`${licenceAtRiskPct.toFixed(0)}%`}
        meta={`${brief.licenceHealth.atRiskCount} of ${brief.licenceHealth.totalCount}`}
        tone={
          licenceAtRiskPct === 0
            ? 'green'
            : licenceAtRiskPct < 25
              ? 'amber'
              : 'red'
        }
        testId="kpi-licence"
      />
      <KpiTile
        label="USD cliff"
        labelSw="Tarehe ya USD"
        value={cliffDays === null ? '—' : `${cliffDays} d`}
        meta={
          brief.cliffStatus.remediationComplete
            ? 'remediation complete'
            : `${brief.cliffStatus.usdDenominated} USD contracts`
        }
        tone={
          brief.cliffStatus.remediationComplete
            ? 'green'
            : cliffDays !== null && cliffDays < 30
              ? 'red'
              : 'amber'
        }
        testId="kpi-cliff"
      />
    </section>
  );
}

interface KpiTileProps {
  readonly label: string;
  readonly labelSw: string;
  readonly value: string;
  readonly meta: string;
  readonly sparkData?: ReadonlyArray<{
    readonly x: string;
    readonly y: number;
  }>;
  readonly tone: 'green' | 'amber' | 'red';
  readonly testId: string;
}

const TONE_TEXT: Record<KpiTileProps['tone'], string> = {
  green: 'text-success',
  amber: 'text-warning',
  red: 'text-destructive',
};

function KpiTile({
  label,
  labelSw,
  value,
  meta,
  sparkData,
  tone,
  testId,
}: KpiTileProps): JSX.Element {
  return (
    <article className="cockpit-card" data-testid={testId}>
      <h3 className="cockpit-card-title">{label}</h3>
      <p className="text-xs italic text-neutral-600">{labelSw}</p>
      <div className={`mt-2 font-display text-3xl ${TONE_TEXT[tone]}`}>
        {value}
      </div>
      <div className="cockpit-card-meta">{meta}</div>
      {sparkData && sparkData.length >= 3 ? (
        <div className="mt-3" data-testid={`${testId}-spark`}>
          <Sparkline
            data={sparkData}
            tone={tone}
            height={40}
            tooltipFormatter={(v) => fmtNum(v)}
          />
        </div>
      ) : null}
    </article>
  );
}

function computeCashDays(
  runway: OwnerBriefPayload['cashRunway'],
): number | null {
  if (runway.dailyAvgTzs <= 0) return null;
  const positiveNet = Math.max(runway.ninetyDayNetTzs, 0);
  return Math.round(positiveNet / Math.abs(runway.dailyAvgTzs));
}

function computeLicenceAtRiskPct(
  licence: OwnerBriefPayload['licenceHealth'],
): number {
  if (licence.totalCount === 0) return 0;
  return (licence.atRiskCount / licence.totalCount) * 100;
}

function computeCliffDaysAway(cliffIso: string): number | null {
  const cliff = new Date(cliffIso);
  if (Number.isNaN(cliff.getTime())) return null;
  const diff = cliff.getTime() - Date.now();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}
