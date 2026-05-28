'use client';

import { useDashboardAuditIntegrity } from '@/lib/internal/queries/dashboard';

/**
 * Audit-chain integrity panel — bottom-right.
 *
 * Reads `/api/v1/audit-trail/verify` for the rolling 24h window. The
 * verifier returns `ok: true` when the hash chain checks end-to-end;
 * any `firstBrokenEntryId` is surfaced verbatim so a responder can
 * jump to the audit-log viewer with a precise pointer.
 */
export function AuditChainIntegrityPanel(): JSX.Element {
  const query = useDashboardAuditIntegrity();

  if (query.isLoading) {
    return (
      <div
        className="h-44 animate-pulse rounded-lg border border-border bg-surface/40 lg:col-span-3"
        data-testid="admin-dashboard-audit-skeleton"
      />
    );
  }

  const data = query.data;
  if (!data || data.state === 'failed') {
    return (
      <article
        className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5 lg:col-span-3"
        data-testid="admin-dashboard-audit-error"
      >
        <h2 className="text-caption uppercase tracking-widest text-warning">
          Audit chain integrity unavailable
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          {data?.reason ??
            (query.error instanceof Error
              ? query.error.message
              : 'Endpoint unreachable')}
        </p>
      </article>
    );
  }

  if (data.state === 'unconfigured') {
    return (
      <article
        className="rounded-2xl border border-border bg-surface/40 p-5 lg:col-span-3"
        data-testid="admin-dashboard-audit-unconfigured"
      >
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Audit chain integrity
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Audit-trail verifier not configured on this gateway. Set
          AUDIT_TRAIL_SIGNING_SECRET and a pipeline slot to enable
          24h hash-chain checks.
        </p>
      </article>
    );
  }

  if (data.state === 'unauthorized') {
    return (
      <article
        className="rounded-lg border border-border bg-surface p-5 lg:col-span-3"
        data-testid="admin-dashboard-audit-unauth"
      >
        <h2 className="text-caption uppercase tracking-widest text-neutral-500">
          Audit chain integrity
        </h2>
        <p className="mt-3 text-sm text-neutral-400">
          Sign in as tenant-admin or super-admin to verify the hash chain.
        </p>
      </article>
    );
  }

  const stateColor = data.valid
    ? 'border-success/40 bg-success-subtle/5'
    : 'border-destructive/40 bg-destructive/5';

  return (
    <article
      className={`rounded-lg border p-5 lg:col-span-3 ${stateColor}`}
      data-testid="admin-dashboard-audit"
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            Audit chain · last 24h
          </h2>
          <p
            className={`mt-1 font-display text-3xl ${
              data.valid ? 'text-success' : 'text-destructive'
            }`}
            data-testid="admin-dashboard-audit-state"
          >
            {data.valid ? 'OK' : 'BROKEN'}
          </p>
          <p className="text-xs text-neutral-500">
            {data.entriesChecked.toLocaleString()} entries checked
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          {formatWindow(data.windowStartIso, data.windowEndIso)}
        </div>
      </header>
      {!data.valid && data.firstBrokenEntryId ? (
        <p className="text-sm text-destructive">
          First broken entry:{' '}
          <code className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-xs">
            {data.firstBrokenEntryId}
          </code>
          {data.reason ? ` · ${data.reason}` : null}
        </p>
      ) : null}
      {data.valid ? (
        <p className="text-sm text-neutral-400">
          Hash chain verifies end-to-end for the last 24 hours.
        </p>
      ) : null}
    </article>
  );
}

function formatWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  return `${fmt(startIso)} → ${fmt(endIso)}`;
}
