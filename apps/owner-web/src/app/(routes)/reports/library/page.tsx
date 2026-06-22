'use client';

/**
 * O-W-18-LIBRARY — Generated reports library.
 *
 * Lists report versions from GET /api/v1/mining/reports (newest first).
 * Each row shows renderKind, generatedAt and links to a report audio
 * player via the ReportPlayerPanel component which handles the narration.
 * The "Generate" flow lives on the parent /reports page.
 */

import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Sparkles,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Alert,
  Button,
} from '@borjie/design-system';
import { apiRequest, ApiError } from '@/lib/api-client';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { fmtDateForLocale } from '@/lib/format';
import { reportsLibraryPageStrings as S } from '@/i18n/strings/reports-library-page';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ReportVersionSchema = z.object({
  id: z.string(),
  reportInstanceId: z.string(),
  renderKind: z.string(),
  version: z.number().nullable(),
  generatedAt: z.string(),
  pdfUrl: z.string().nullable().optional(),
});

type ReportVersion = z.infer<typeof ReportVersionSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_KEYS: Record<string, keyof typeof S> = {
  daily: 'kindDaily',
  weekly: 'kindWeekly',
  monthly: 'kindMonthly',
  investor: 'kindInvestor',
  board: 'kindBoard',
  audit: 'kindAudit',
  'community-update': 'kindCommunity',
};

function kindLabel(kind: string, locale: Locale): string {
  const key = KIND_KEYS[kind];
  return key ? pickByLocale(locale, S[key]) : kind;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function useReportLibrary(limit = 50) {
  return useQuery({
    queryKey: ['mining', 'reports', 'library', limit],
    queryFn: ({ signal }) =>
      apiRequest<unknown>(`/api/v1/mining/reports?limit=${limit}`, { signal }),
    select: (raw): ReadonlyArray<ReportVersion> => {
      if (Array.isArray(raw)) {
        return z.array(ReportVersionSchema).parse(raw);
      }
      const env = z
        .object({ success: z.literal(true), data: z.array(ReportVersionSchema) })
        .safeParse(raw);
      return env.success ? env.data.data : [];
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsLibraryPage() {
  const locale = useLocale();
  const { data, isLoading, isError, error } = useReportLibrary();
  const versions = data ?? [];

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Back */}
      <div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {pickByLocale(locale, S.back)}
        </Link>
      </div>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
            <FileText className="h-3.5 w-3.5" />
            <span>{pickByLocale(locale, S.eyebrow)}</span>
          </div>
          <h1 className="font-display text-2xl font-medium text-foreground">
            {pickByLocale(locale, S.title)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {pickByLocale(locale, S.subtitle)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
          >
            <FileText className="h-3.5 w-3.5" />
            {pickByLocale(locale, S.generate)}
          </Link>
          <Link
            href="/ask?prompt=reports"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {pickByLocale(locale, S.ask)}
          </Link>
        </div>
      </header>

      {/* Loading */}
      {isLoading ? (
        <div
          className="space-y-3"
          role="status"
          aria-label={pickByLocale(locale, S.loadingAria)}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl border border-border" />
          ))}
        </div>
      ) : null}

      {/* Error */}
      {isError ? (
        <Alert variant="error">
          {error instanceof ApiError
            ? error.message
            : pickByLocale(locale, S.loadError)}
        </Alert>
      ) : null}

      {/* Empty */}
      {!isLoading && !isError && versions.length === 0 ? (
        <ScreenEmptyState
          icon={<FileText className="h-6 w-6" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
          action={
            <Button asChild variant="primary" size="sm">
              <Link href="/reports">{pickByLocale(locale, S.emptyCta)}</Link>
            </Button>
          }
        />
      ) : null}

      {/* Report list */}
      {versions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pickByLocale(locale, S.colType)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colGenerated)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colVersion)}</TableHead>
              <TableHead className="text-right">
                {pickByLocale(locale, S.colActions)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <p className="text-sm font-medium text-foreground">
                    {kindLabel(v.renderKind, locale)}
                  </p>
                  <p className="mt-0.5 font-mono text-tiny text-muted-foreground">
                    {v.reportInstanceId.slice(0, 12)}…
                  </p>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDateForLocale(v.generatedAt, locale)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {v.version !== null ? `v${v.version}` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-3">
                    {v.pdfUrl ? (
                      <a
                        href={v.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-signal-500 hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        PDF
                      </a>
                    ) : null}
                    <Link
                      href={`/ask?prompt=report+${v.reportInstanceId}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Sparkles className="h-3 w-3" />
                      {pickByLocale(locale, S.discuss)}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
