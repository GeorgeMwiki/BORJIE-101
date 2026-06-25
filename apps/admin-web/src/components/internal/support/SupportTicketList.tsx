'use client';

import { LifeBuoy } from 'lucide-react';
import { Skeleton, Alert, Empty } from '@borjie/design-system';
import {
  useSupportTicketsQuery,
  type SupportTicket,
} from '@/lib/internal/queries/support';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';
import { localizeEnumLabel, SEVERITY_LABELS } from '@/lib/internal/enum-labels';

/**
 * Live HQ support queue.
 *
 * Binds to GET /api/v1/mining/internal/support/tickets — the union of
 * unresolved compliance escalations awaiting a human operator. Read-only:
 * the gateway does not yet expose a ticket-acknowledge route, so each row
 * shows severity + SLA waiting time without an inline action.
 */
const S = {
  loading: { en: 'Loading tickets…', sw: 'Inapakia tiketi…' },
  emptyTitle: { en: 'No open tickets', sw: 'Hakuna tiketi zilizo wazi' },
  emptyBody: {
    en: 'Unresolved compliance escalations awaiting an operator surface here. The queue is currently clear.',
    sw: 'Visa vya uzingatiaji ambavyo havijatatuliwa vinavyosubiri opereta huonekana hapa. Foleni kwa sasa iko wazi.',
  },
  platform: { en: 'platform', sw: 'jukwaa' },
} as const;

function severityTone(sev: string): 'danger' | 'warn' | 'neutral' {
  const s = sev.toLowerCase();
  if (s === 'high' || s === 'critical') return 'danger';
  if (s === 'medium') return 'warn';
  return 'neutral';
}

export function SupportTicketList({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useSupportTicketsQuery();

  if (query.isPending) {
    return (
      <Skeleton
        className="h-48 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{localizeApiError(query.error, locale)}</Alert>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Empty
          icon={<LifeBuoy className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.map((ticket: SupportTicket) => (
          <article key={ticket.id} className="px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-foreground">{ticket.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {ticket.tenantId ?? pickByLocale(locale, S.platform)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StubBadge tone={severityTone(ticket.severity)}>
                  {localizeEnumLabel(SEVERITY_LABELS, ticket.severity, locale)}
                </StubBadge>
                <span className="text-xs text-muted-foreground">
                  {ticket.waitingHours}h
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />
    </div>
  );
}
