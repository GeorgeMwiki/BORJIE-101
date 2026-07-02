'use client';

import { Card } from '@borjie/design-system';

import { useDashboardAuditIntegrity } from '@/lib/internal/queries/dashboard';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';

// Every rendered string in BOTH locales — one language per active locale,
// never English-under-sw. The wire carries machine state tokens
// (`failed`/`unconfigured`/`unauthorized`/`valid`); the FE localizes the
// prose at render so the default console landing is single-locale.
const S = {
  unavailableTitle: {
    en: 'Audit chain integrity unavailable',
    sw: 'Uadilifu wa mnyororo wa ukaguzi haupatikani',
  },
  endpointUnreachable: { en: 'Endpoint unreachable', sw: 'Mwisho haufikiki' },
  heading: { en: 'Audit chain integrity', sw: 'Uadilifu wa mnyororo wa ukaguzi' },
  unconfigured: {
    en: 'Audit-trail verifier not configured on this gateway. Set AUDIT_TRAIL_SIGNING_SECRET and a pipeline slot to enable 24h hash-chain checks.',
    sw: 'Mthibitishaji wa njia-ya-ukaguzi haujasanidiwa kwenye lango hili. Weka AUDIT_TRAIL_SIGNING_SECRET na nafasi ya bomba ili kuwezesha ukaguzi wa mnyororo-mseto wa saa 24.',
  },
  unauthorized: {
    en: 'Sign in as tenant-admin or super-admin to verify the hash chain.',
    sw: 'Ingia kama msimamizi-pangaji au msimamizi-mkuu ili kuthibitisha mnyororo-mseto.',
  },
  headingWindow: { en: 'Audit chain · last 24h', sw: 'Mnyororo wa ukaguzi · saa 24 za mwisho' },
  entriesChecked: { en: 'entries checked', sw: 'maingizo yaliyokaguliwa' },
  firstBroken: { en: 'First broken entry:', sw: 'Ingizo la kwanza lililovunjika:' },
  verifiesOk: {
    en: 'Hash chain verifies end-to-end for the last 24 hours.',
    sw: 'Mnyororo-mseto unathibitika mwanzo-mwisho kwa saa 24 zilizopita.',
  },
} as const;

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
  const locale = useLocale();

  if (query.isLoading) {
    return (
      <Card
        className="h-44 animate-pulse bg-surface/40 lg:col-span-3"
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
          {pickByLocale(locale, S.unavailableTitle)}
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          {data?.reason ??
            (query.error instanceof Error
              ? query.error.message
              : pickByLocale(locale, S.endpointUnreachable))}
        </p>
      </article>
    );
  }

  if (data.state === 'unconfigured') {
    return (
      <Card
        className="rounded-2xl bg-surface/40 p-5 lg:col-span-3"
        data-testid="admin-dashboard-audit-unconfigured"
      >
        <h2 className="font-mono text-mini font-semibold uppercase tracking-eyebrow text-neutral-500">
          {pickByLocale(locale, S.heading)}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {pickByLocale(locale, S.unconfigured)}
        </p>
      </Card>
    );
  }

  if (data.state === 'unauthorized') {
    return (
      <Card
        className="bg-surface p-5 lg:col-span-3"
        data-testid="admin-dashboard-audit-unauth"
      >
        <h2 className="text-caption uppercase tracking-widest text-neutral-500">
          {pickByLocale(locale, S.heading)}
        </h2>
        <p className="mt-3 text-sm text-neutral-400">
          {pickByLocale(locale, S.unauthorized)}
        </p>
      </Card>
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
            {pickByLocale(locale, S.headingWindow)}
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
            {data.entriesChecked.toLocaleString(bcp47For(locale))}{' '}
            {pickByLocale(locale, S.entriesChecked)}
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          {formatWindow(data.windowStartIso, data.windowEndIso, bcp47For(locale))}
        </div>
      </header>
      {!data.valid && data.firstBrokenEntryId ? (
        <p className="text-sm text-destructive">
          {pickByLocale(locale, S.firstBroken)}{' '}
          <code className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-xs">
            {data.firstBrokenEntryId}
          </code>
          {data.reason ? ` · ${data.reason}` : null}
        </p>
      ) : null}
      {data.valid ? (
        <p className="text-sm text-neutral-400">
          {pickByLocale(locale, S.verifiesOk)}
        </p>
      ) : null}
    </article>
  );
}

function formatWindow(startIso: string, endIso: string, bcp47: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(bcp47, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  return `${fmt(startIso)} → ${fmt(endIso)}`;
}
