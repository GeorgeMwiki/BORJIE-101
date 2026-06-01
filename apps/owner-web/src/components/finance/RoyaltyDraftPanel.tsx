'use client';

import { useMemo } from 'react';
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  Clock,
  PenLine,
} from 'lucide-react';
import Link from 'next/link';
import { fmtTzs } from '@/lib/format';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { dataBStrings as S } from '@/i18n/strings/data-b';

interface RoyaltyDraftPanelProps {
  readonly locale?: 'sw' | 'en';
}

type CutOffKey = 'royaltyCutOff7d' | 'royaltySignedYesterday';

interface DraftRow {
  readonly id: string;
  readonly mineral: string;
  readonly rate: number; // 0.06 = 6%
  readonly grossTzs: number;
  readonly royaltyTzs: number;
  readonly status: 'draft' | 'reviewing' | 'signed' | 'submitted';
  readonly cutOff: CutOffKey;
}

// Curated April-26 draft until the live `/royalties/draft` endpoint
// lands; rates anchored on the Tanzanian mining-act schedule.
const APRIL_DRAFTS: ReadonlyArray<DraftRow> = [
  {
    id: 'gold-nyakabale',
    mineral: 'Gold (Nyakabale)',
    rate: 0.06,
    grossTzs: 412_000_000,
    royaltyTzs: 24_720_000,
    status: 'draft',
    cutOff: 'royaltyCutOff7d',
  },
  {
    id: 'gold-kakola',
    mineral: 'Gold (Kakola)',
    rate: 0.06,
    grossTzs: 198_000_000,
    royaltyTzs: 11_880_000,
    status: 'reviewing',
    cutOff: 'royaltyCutOff7d',
  },
  {
    id: 'coltan-mbeya',
    mineral: 'Coltan (Mbeya Ridge)',
    rate: 0.03,
    grossTzs: 64_500_000,
    royaltyTzs: 1_935_000,
    status: 'draft',
    cutOff: 'royaltyCutOff7d',
  },
  {
    id: 'gemstones-arusha',
    mineral: 'Gemstones (Arusha)',
    rate: 0.03,
    grossTzs: 18_400_000,
    royaltyTzs: 552_000,
    status: 'signed',
    cutOff: 'royaltySignedYesterday',
  },
];

function statusTone(status: DraftRow['status']) {
  if (status === 'submitted') {
    return {
      pill: 'border-success/40 bg-success/10 text-success',
      label: S.royaltyStatusSubmitted,
      icon: CheckCircle2,
    };
  }
  if (status === 'signed') {
    return {
      pill: 'border-info/40 bg-info/10 text-info',
      label: S.royaltyStatusSigned,
      icon: PenLine,
    };
  }
  if (status === 'reviewing') {
    return {
      pill: 'border-warning/40 bg-warning/10 text-warning',
      label: S.royaltyStatusReviewing,
      icon: Clock,
    };
  }
  return {
    pill: 'border-border bg-surface text-neutral-300',
    label: S.royaltyStatusDraft,
    icon: PenLine,
  };
}

/**
 * Monthly royalty draft panel.
 *
 * Renders each mineral / rate / draft amount / signature status as a
 * row in a dense table, plus a CTA strip at top to advance the whole
 * batch to signature. Plugs into `/api/v1/mining/royalties/draft`
 * once the endpoint lands — currently uses the curated April-26
 * fixture.
 */
export function RoyaltyDraftPanel({ locale = 'en' }: RoyaltyDraftPanelProps): JSX.Element {
  const isSw = locale === 'sw';

  const totals = useMemo(() => {
    return APRIL_DRAFTS.reduce(
      (acc, row) => ({
        gross: acc.gross + row.grossTzs,
        royalty: acc.royalty + row.royaltyTzs,
      }),
      { gross: 0, royalty: 0 },
    );
  }, []);

  const drafts = APRIL_DRAFTS.filter((r) => r.status === 'draft').length;
  const signed = APRIL_DRAFTS.filter((r) => r.status === 'signed').length;

  const metrics: readonly MetricTile[] = [
    {
      label: isSw ? S.royaltyMetricGrossLabel.sw : S.royaltyMetricGrossLabel.en,
      value: fmtTzs(totals.gross),
      sub: isSw ? S.royaltyMetricGrossSub.sw : S.royaltyMetricGrossSub.en,
      icon: Calculator,
    },
    {
      label: isSw
        ? S.royaltyMetricRoyaltyLabel.sw
        : S.royaltyMetricRoyaltyLabel.en,
      value: fmtTzs(totals.royalty),
      sub: isSw ? S.royaltyMetricRoyaltySub.sw : S.royaltyMetricRoyaltySub.en,
      icon: ArrowRight,
      tone: 'warning',
    },
    {
      label: isSw
        ? S.royaltyMetricDraftsLabel.sw
        : S.royaltyMetricDraftsLabel.en,
      value: String(drafts),
      sub: isSw ? S.royaltyMetricDraftsSub.sw : S.royaltyMetricDraftsSub.en,
      icon: PenLine,
      tone: drafts > 0 ? 'warning' : 'success',
    },
    {
      label: isSw
        ? S.royaltyMetricSignedLabel.sw
        : S.royaltyMetricSignedLabel.en,
      value: String(signed),
      sub: isSw ? S.royaltyMetricSignedSub.sw : S.royaltyMetricSignedSub.en,
      icon: CheckCircle2,
      tone: 'success',
    },
  ];

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {isSw ? S.royaltyPanelTitle.sw : S.royaltyPanelTitle.en}
            </h2>
            <p className="text-xs text-neutral-400">
              {isSw ? S.royaltyPanelSubtitle.sw : S.royaltyPanelSubtitle.en}
            </p>
          </div>
          <Link
            href="/finance/royalties/sign"
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-3 py-1.5 text-xs font-semibold text-background hover:bg-signal-400"
          >
            {isSw ? S.royaltySignBatch.sw : S.royaltySignBatch.en}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </header>
        <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
          <div className="col-span-4">
            {isSw ? S.royaltyColMineral.sw : S.royaltyColMineral.en}
          </div>
          <div className="col-span-1">
            {isSw ? S.royaltyColRate.sw : S.royaltyColRate.en}
          </div>
          <div className="col-span-2 text-right">
            {isSw ? S.royaltyColGross.sw : S.royaltyColGross.en}
          </div>
          <div className="col-span-2 text-right">
            {isSw ? S.royaltyColRoyalty.sw : S.royaltyColRoyalty.en}
          </div>
          <div className="col-span-3 text-right">
            {isSw ? S.royaltyColStatus.sw : S.royaltyColStatus.en}
          </div>
        </div>
        <ul className="divide-y divide-border/60">
          {APRIL_DRAFTS.map((row) => {
            const tone = statusTone(row.status);
            const Icon = tone.icon;
            return (
              <li
                key={row.id}
                className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="col-span-4">
                  <div className="text-sm font-medium text-foreground">
                    {row.mineral}
                  </div>
                  <div className="mt-0.5 text-tiny font-mono uppercase tracking-widest text-neutral-500">
                    {isSw ? S[row.cutOff].sw : S[row.cutOff].en}
                  </div>
                </div>
                <div className="col-span-1 text-xs text-neutral-300">
                  {(row.rate * 100).toFixed(0)}%
                </div>
                <div className="col-span-2 text-right font-mono text-sm text-neutral-300">
                  {fmtTzs(row.grossTzs)}
                </div>
                <div className="col-span-2 text-right font-mono text-sm font-medium text-foreground">
                  {fmtTzs(row.royaltyTzs)}
                </div>
                <div className="col-span-3 flex justify-start md:justify-end">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-badge font-medium ${tone.pill}`}
                  >
                    <Icon className="h-3 w-3" />
                    {isSw ? tone.label.sw : tone.label.en}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
