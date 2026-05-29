import { QueryProvider } from '@/components/internal/QueryProvider';
import { AuditLogViewer } from '@/components/internal/audit-log/AuditLogViewer';

/**
 * Audit log — sticky filter bar + virtualised event stream.
 *
 * Mirrors LitFin's `/litfin-admin/audit` composition: page header,
 * append-only badge in the actions slot, then the shared filterable
 * AuditLogViewer (tenant + actor + date-range filters, virtualised
 * VirtualList for tens-of-thousands of events without jank).
 */
export default function AuditPage(): JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="font-mono text-tiny uppercase tracking-widest text-signal-500">
              Audit · Ukaguzi
            </p>
            <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              Audit log
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
              Append-only, hash-chained activity stream. Filter by tenant,
              actor, or date range; export NDJSON ships with the audit-log
              export endpoint.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-info/50 bg-info/10 px-2.5 py-1 text-tiny font-mono uppercase tracking-widest text-info">
            Append-only
          </span>
        </header>

        <AuditLogViewer />
      </div>
    </QueryProvider>
  );
}
