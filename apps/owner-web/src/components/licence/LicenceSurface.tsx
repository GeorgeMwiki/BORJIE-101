'use client';

import { useLicenceCockpit } from '@/lib/queries/licence';
import { ApiError, localizeError } from '@/lib/api-client';
import { EmptyState } from '@/components/shared/EmptyState';
import { useLocale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import {
  licenceCockpitStrings as S,
  mineralLabel,
} from '@/i18n/strings/licence-cockpit';
import { CountdownCards } from './CountdownCards';
import { DormancyCard } from './DormancyCard';
import { PaymentHistory } from './PaymentHistory';
import { RenewalActions } from './RenewalActions';

interface LicenceSurfaceProps {
  readonly licenceId: string;
}

export function LicenceSurface({ licenceId }: LicenceSurfaceProps) {
  const locale = useLocale();
  const { data, isLoading, isError, error } = useLicenceCockpit(licenceId);

  if (isLoading) {
    return (
      <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
    );
  }
  // Honest error states — no more infinite skeleton on a 404 / bad id.
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    // Localize the gateway error by its stable CODE — never the raw English
    // `error.message` (rendering that under `sw` is language MIXING).
    const detail = error
      ? localizeError(error, locale)
      : pickByLocale(locale, S.surface.loadErrorRetry);
    return (
      <EmptyState
        title={pickByLocale(
          locale,
          notFound ? S.surface.notFoundTitle : S.surface.loadErrorTitle,
        )}
        description={
          notFound
            ? pickByLocale(locale, S.surface.notFoundBody)
            : pickByLocale(locale, S.surface.loadErrorBody(detail))
        }
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        title={pickByLocale(locale, S.surface.noDataTitle)}
        description={pickByLocale(locale, S.surface.noDataBody)}
      />
    );
  }
  return (
    <div className="space-y-5">
      <CountdownCards
        daysToWindow={data.daysToWindow}
        windowOpensAt={data.windowOpensAt}
        windowClosesAt={data.windowClosesAt}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DormancyCard score={data.dormancyScore} citation={data.dormancyCitation} />
        <RenewalActions
          licenceId={data.id}
          completePct={data.renewalPackCompletePct}
          missing={data.renewalPackMissing}
        />
        <div className="lg:col-span-1">
          <article className="rounded-md border border-border bg-surface px-4 py-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              {pickByLocale(locale, S.surface.summaryTitle)}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-neutral-500">
                {pickByLocale(locale, S.surface.refLabel)}
              </dt>
              <dd className="text-foreground">{data.reference}</dd>
              <dt className="text-neutral-500">
                {pickByLocale(locale, S.surface.mineralLabel)}
              </dt>
              <dd className="text-foreground">
                {mineralLabel(locale, data.mineral)}
              </dd>
              <dt className="text-neutral-500">
                {pickByLocale(locale, S.surface.siteLabel)}
              </dt>
              <dd className="text-foreground">{data.siteName}</dd>
            </dl>
          </article>
        </div>
      </div>
      <PaymentHistory payments={data.payments} />
    </div>
  );
}
