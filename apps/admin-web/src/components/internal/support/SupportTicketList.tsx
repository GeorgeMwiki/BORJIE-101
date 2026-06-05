'use client';

import {
  useSupportTicketsQuery,
  type SupportTicket,
} from '@/lib/internal/queries/support';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';

/**
 * Live HQ support queue.
 *
 * Binds to GET /api/v1/mining/internal/support/tickets — the union of
 * unresolved compliance escalations awaiting a human operator. Read-only:
 * the gateway does not yet expose a ticket-acknowledge route, so each row
 * shows severity + SLA waiting time without an inline action.
 */
function severityTone(sev: string): 'danger' | 'warn' | 'neutral' {
  const s = sev.toLowerCase();
  if (s === 'high' || s === 'critical') return 'danger';
  if (s === 'medium') return 'warn';
  return 'neutral';
}

export function SupportTicketList(): JSX.Element {
  const query = useSupportTicketsQuery();

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading tickets…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-neutral-500">
            No open tickets.
          </p>
        ) : (
          rows.map((ticket: SupportTicket) => (
            <article key={ticket.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-foreground">{ticket.summary}</p>
                  <p className="text-xs text-neutral-400">
                    {ticket.tenantId ?? 'platform'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StubBadge tone={severityTone(ticket.severity)}>
                    {ticket.severity}
                  </StubBadge>
                  <span className="text-xs text-neutral-500">
                    {ticket.waitingHours}h
                  </span>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
    </div>
  );
}
