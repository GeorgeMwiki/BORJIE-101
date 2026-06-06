'use client';

import { useLicenceCockpit } from '@/lib/queries/licence';
import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/shared/EmptyState';
import { CountdownCards } from './CountdownCards';
import { DormancyCard } from './DormancyCard';
import { PaymentHistory } from './PaymentHistory';
import { RenewalActions } from './RenewalActions';

interface LicenceSurfaceProps {
  readonly licenceId: string;
}

export function LicenceSurface({ licenceId }: LicenceSurfaceProps) {
  const { data, isLoading, isError, error } = useLicenceCockpit(licenceId);

  if (isLoading) {
    return (
      <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
    );
  }
  // Honest error states — no more infinite skeleton on a 404 / bad id.
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <EmptyState
        title={notFound ? 'Licence not found' : 'Could not load this licence'}
        description={
          notFound
            ? 'This licence does not exist for your account, or the link is stale. Open a licence from your licences list.'
            : `The licence cockpit failed to load. ${
                error instanceof Error ? error.message : 'Please try again.'
              }`
        }
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        title="No licence data"
        description="This licence has no renewal, dormancy, or payment data recorded yet."
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
              Licence summary
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-neutral-500">Reference</dt>
              <dd className="text-foreground">{data.reference}</dd>
              <dt className="text-neutral-500">Mineral</dt>
              <dd className="text-foreground">{data.mineral}</dd>
              <dt className="text-neutral-500">Site</dt>
              <dd className="text-foreground">{data.siteName}</dd>
            </dl>
          </article>
        </div>
      </div>
      <PaymentHistory payments={data.payments} />
    </div>
  );
}
