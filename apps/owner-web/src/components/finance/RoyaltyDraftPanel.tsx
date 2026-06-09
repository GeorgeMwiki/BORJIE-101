'use client';

import { useMemo } from 'react';
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  Clock,
  Loader2,
  PenLine,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';
import { fmtTzs } from '@/lib/format';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { dataBStrings as S } from '@/i18n/strings/data-b';
import { routesBStrings as RB } from '@/i18n/strings/routes-b';

interface RoyaltyDraftPanelProps {
  readonly locale?: 'sw' | 'en';
}

// ---------------------------------------------------------------------------
// Types from /api/v1/mining/royalty
// ---------------------------------------------------------------------------

const DraftSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  mineral: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  status: z.string(),
  royaltyAmount: z.number().nullable(),
  currency: z.string().nullable(),
  ledgerJournalId: z.string().nullable(),
  signed: z.boolean(),
  createdAt: z.string(),
});

type Draft = z.infer<typeof DraftSchema>;

const ListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    drafts: z.array(DraftSchema),
  }),
});

// ---------------------------------------------------------------------------
// Status rendering
// ---------------------------------------------------------------------------

type CutOffKey = 'royaltyCutOff7d' | 'royaltySignedYesterday';

function resolveCutOff(status: string): CutOffKey {
  return status === 'submitted' || status === 'signed'
    ? 'royaltySignedYesterday'
    : 'royaltyCutOff7d';
}

type StatusTone = {
  readonly pill: string;
  readonly label: { readonly sw: string; readonly en: string };
  readonly icon: React.ElementType;
};

function statusTone(status: string): StatusTone {
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

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const QUERY_KEY = ['mining', 'royalty', 'drafts'] as const;

function useRoyaltyDrafts() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/mining/royalty', { signal }),
    select: (raw): ReadonlyArray<Draft> => {
      const parsed = ListResponseSchema.safeParse(raw);
      return parsed.success ? parsed.data.data.drafts : [];
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Monthly royalty draft panel.
 *
 * Fetches live draft data from GET /api/v1/mining/royalty (newest first)
 * and renders each mineral / rate / draft amount / signature status as a
 * dense table row. Replaces the April-2026 fixture that was previously
 * hard-coded here.
 */
export function RoyaltyDraftPanel({
  locale = 'en',
}: RoyaltyDraftPanelProps): JSX.Element {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, error } = useRoyaltyDrafts();
  const drafts = data ?? [];

  const totals = useMemo(() => {
    return drafts.reduce(
      (acc, row) => ({
        royalty: acc.royalty + (row.royaltyAmount ?? 0),
      }),
      { royalty: 0 },
    );
  }, [drafts]);

  const draftCount = drafts.filter(
    (r) => r.status === 'draft' || r.status === 'reviewing',
  ).length;
  const signedCount = drafts.filter(
    (r) => r.signed || r.status === 'submitted',
  ).length;

  const metrics: readonly MetricTile[] = [
    {
      label: isSw ? S.royaltyMetricRoyaltyLabel.sw : S.royaltyMetricRoyaltyLabel.en,
      value: totals.royalty > 0 ? fmtTzs(totals.royalty) : '—',
      sub: isSw ? S.royaltyMetricRoyaltySub.sw : S.royaltyMetricRoyaltySub.en,
      icon: Calculator,
      tone: 'warning',
    },
    {
      label: isSw ? S.royaltyMetricDraftsLabel.sw : S.royaltyMetricDraftsLabel.en,
      value: String(draftCount),
      sub: isSw ? S.royaltyMetricDraftsSub.sw : S.royaltyMetricDraftsSub.en,
      icon: PenLine,
      tone: draftCount > 0 ? 'warning' : 'success',
    },
    {
      label: isSw ? S.royaltyMetricSignedLabel.sw : S.royaltyMetricSignedLabel.en,
      value: String(signedCount),
      sub: isSw ? S.royaltyMetricSignedSub.sw : S.royaltyMetricSignedSub.en,
      icon: CheckCircle2,
      tone: 'success',
    },
  ];

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={3} />

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

        {/* Loading */}
        {isLoading ? (
          <div className="flex items-center gap-2 px-5 py-6 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isSw
              ? RB.sharedClientStrings.loadingDrafts.sw
              : RB.sharedClientStrings.loadingDrafts.en}
          </div>
        ) : null}

        {/* Error */}
        {isError ? (
          <div className="px-5 py-6">
            <p className="text-xs text-destructive">
              {error instanceof ApiError
                ? error.message
                : isSw
                  ? RB.sharedClientStrings.couldNotLoadRoyaltyDrafts.sw
                  : RB.sharedClientStrings.couldNotLoadRoyaltyDrafts.en}
            </p>
          </div>
        ) : null}

        {/* Empty */}
        {!isLoading && !isError && drafts.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-neutral-500" />
            <p className="mt-2 text-sm text-neutral-400">
              {isSw
                ? RB.sharedClientStrings.noRoyaltyDrafts.sw
                : RB.sharedClientStrings.noRoyaltyDrafts.en}
            </p>
          </div>
        ) : null}

        {/* Table */}
        {drafts.length > 0 ? (
          <>
            <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
              <div className="col-span-4">
                {isSw ? S.royaltyColMineral.sw : S.royaltyColMineral.en}
              </div>
              <div className="col-span-2">
                {isSw ? S.royaltyColRate.sw : S.royaltyColRate.en}
              </div>
              <div className="col-span-3 text-right">
                {isSw ? S.royaltyColRoyalty.sw : S.royaltyColRoyalty.en}
              </div>
              <div className="col-span-3 text-right">
                {isSw ? S.royaltyColStatus.sw : S.royaltyColStatus.en}
              </div>
            </div>
            <ul className="divide-y divide-border/60">
              {drafts.map((row) => {
                const tone = statusTone(row.status);
                const Icon = tone.icon;
                const cutOff = resolveCutOff(row.status);
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
                        {isSw ? S[cutOff].sw : S[cutOff].en}
                      </div>
                    </div>
                    <div className="col-span-2 text-xs text-neutral-300">
                      {row.quantity !== null && row.unit
                        ? `${row.quantity.toLocaleString()} ${row.unit}`
                        : '—'}
                    </div>
                    <div className="col-span-3 text-right font-mono text-sm font-medium text-foreground">
                      {row.royaltyAmount !== null
                        ? fmtTzs(row.royaltyAmount)
                        : '—'}
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
          </>
        ) : null}
      </div>
    </div>
  );
}
