'use client';

import {
  Skeleton,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import {
  useAuditPacksQuery,
  type AuditPack,
} from '@/lib/internal/queries/audit-pack';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';

const S = {
  emptyTitle: { en: 'No audit-packs issued yet', sw: 'Hakuna pakiti za ukaguzi bado' },
  emptyBody: {
    en: 'Mint a regulator audit-pack above to issue the first one.',
    sw: 'Tengeneza pakiti ya ukaguzi ya mdhibiti hapo juu ili kutoa ya kwanza.',
  },
  colPack: { en: 'Pack', sw: 'Pakiti' },
  colTenant: { en: 'Tenant', sw: 'Mteja' },
  colRegulator: { en: 'Regulator', sw: 'Mdhibiti' },
  colIssued: { en: 'Issued', sw: 'Imetolewa' },
  colExpires: { en: 'Expires', sw: 'Inaisha' },
  colStatus: { en: 'Status', sw: 'Hali' },
  colDownload: { en: 'Download', sw: 'Pakua' },
  download: { en: 'Download', sw: 'Pakua' },
  pendingBundle: { en: 'Pending bundle', sw: 'Inasubiri kifurushi' },
} as const;

// Audit-pack status arrives as an open machine token. Map the known
// lifecycle values to per-locale labels; an unknown token falls back to the
// raw (locale-neutral) string rather than ever rendering a foreign word.
const STATUS_LABEL: Record<string, { en: string; sw: string }> = {
  ready: { en: 'ready', sw: 'tayari' },
  pending: { en: 'pending', sw: 'inasubiri' },
  revoked: { en: 'revoked', sw: 'imebatilishwa' },
  expired: { en: 'expired', sw: 'imeisha' },
};

function statusLabel(status: string, locale: Locale): string {
  const entry = STATUS_LABEL[status.toLowerCase()];
  return entry ? pickByLocale(locale, entry) : status;
}

/**
 * Live issued audit-pack list.
 *
 * Binds to GET /api/v1/mining/internal/audit-pack over the real
 * `audit_packs` table. A pending pack has no signed URL yet — the download
 * link only renders once a real bundling/presign step fills `signedUrl`.
 */
function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'ready') return 'success';
  if (s === 'pending') return 'warn';
  if (s === 'revoked' || s === 'expired') return 'danger';
  return 'neutral';
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

export function AuditPackList({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useAuditPacksQuery();

  if (query.isPending) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-2/3 rounded-md" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{localizeApiError(query.error, locale)}</p>;
  }

  const rows = query.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source="live" locale={locale} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pickByLocale(locale, S.colPack)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colTenant)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colRegulator)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colIssued)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colExpires)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colStatus)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colDownload)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row: AuditPack) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.id.slice(0, 8)}…
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.tenantId.slice(0, 8)}…
                </TableCell>
                <TableCell className="text-muted-foreground">{row.regulator}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {fmt(row.issuedAt)}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {fmt(row.expiresAt)}
                </TableCell>
                <TableCell>
                  <StubBadge tone={statusTone(row.status)}>
                    {statusLabel(row.status, locale)}
                  </StubBadge>
                </TableCell>
                <TableCell>
                  {row.signedUrl ? (
                    <a
                      href={row.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-signal-500 hover:underline"
                    >
                      {pickByLocale(locale, S.download)}
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {pickByLocale(locale, S.pendingBundle)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DataSourceBadge source="live" locale={locale} />
    </div>
  );
}
