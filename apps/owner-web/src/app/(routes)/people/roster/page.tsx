'use client';

/**
 * O-W-08-ROSTER — Worker roster surface.
 *
 * Shows today's per-site headcount from GET /api/v1/mining/attendance/headcount
 * and the attendance history (GET /api/v1/mining/attendance) for the current
 * tenant. No per-worker GET list endpoint exists yet on the gateway — the
 * per-worker detail flows through Mr. Mwikila (org-admin brain tools).
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, HardHat, Sparkles, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Alert,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { apiRequest, ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/shared/EmptyState';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import { peopleRosterStrings as S } from '@/i18n/strings/people-roster-page';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const HeadcountSiteSchema = z.object({
  siteId: z.string().nullable(),
  headcount: z.number(),
});

const HeadcountResponseSchema = z.object({
  groupBy: z.literal('site'),
  perSite: z.array(HeadcountSiteSchema),
});

const AttendanceRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  siteId: z.string().nullable(),
  eventType: z.string(),
  workDate: z.string(),
  clockIn: z.string().nullable(),
  clockOut: z.string().nullable(),
  createdAt: z.string().optional(),
});

const AttendanceListSchema = z.object({
  success: z.literal(true),
  data: z.object({
    records: z.array(AttendanceRowSchema),
    total: z.number(),
  }),
});

type AttendanceRow = z.infer<typeof AttendanceRowSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(iso: string | null, locale: Locale): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString(bcp47For(locale), {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleDateString(bcp47For(locale), {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function useHeadcount() {
  return useQuery({
    queryKey: ['people', 'headcount', 'today'],
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/mining/attendance/headcount?groupBy=site', { signal }),
    select: (raw) => {
      const parsed = HeadcountResponseSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    staleTime: 60_000,
  });
}

function useAttendanceHistory() {
  return useQuery({
    queryKey: ['people', 'attendance', 'history'],
    queryFn: ({ signal }) => apiRequest<unknown>('/api/v1/mining/attendance?limit=50', { signal }),
    select: (raw): ReadonlyArray<AttendanceRow> => {
      const parsed = AttendanceListSchema.safeParse(raw);
      return parsed.success ? parsed.data.data.records : [];
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PeopleRosterPage() {
  const locale = useLocale();
  const headcountQuery = useHeadcount();
  const attendanceQuery = useAttendanceHistory();

  const totalOnShift = useMemo(() => {
    const hc = headcountQuery.data;
    if (!hc) return null;
    return hc.perSite.reduce((sum, s) => sum + s.headcount, 0);
  }, [headcountQuery.data]);

  const isLoading = headcountQuery.isLoading || attendanceQuery.isLoading;
  const records = attendanceQuery.data ?? [];

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Back */}
      <div>
        <Link
          href="/people"
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
            <Users className="h-3.5 w-3.5" />
            <span>{pickByLocale(locale, S.eyebrow)}</span>
          </div>
          <h1 className="font-display text-2xl font-medium text-foreground">
            {pickByLocale(locale, S.title)}
          </h1>
          <p className="text-sm text-muted-foreground">{pickByLocale(locale, S.intro)}</p>
        </div>
        <Link
          href="/ask?prompt=roster"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {pickByLocale(locale, S.askMwikila)}
        </Link>
      </header>

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl border border-border" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-2xl border border-border" />
        </div>
      ) : null}

      {/* Per-site headcount */}
      {!isLoading && headcountQuery.data ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {pickByLocale(locale, S.headcountTitle)}
            {totalOnShift !== null ? (
              <span className="ml-2 font-mono text-xs text-signal-500">
                {totalOnShift} {pickByLocale(locale, S.totalSuffix)}
              </span>
            ) : null}
          </h2>
          {headcountQuery.data.perSite.length === 0 ? (
            <p className="text-sm text-muted-foreground">{pickByLocale(locale, S.noClockToday)}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {headcountQuery.data.perSite.map((site) => (
                <div
                  key={site.siteId ?? 'unknown'}
                  className="rounded-xl border border-border bg-surface/40 p-4"
                >
                  <div className="flex items-center gap-2">
                    <HardHat className="h-4 w-4 text-signal-500" />
                    <span className="font-mono text-xs text-muted-foreground">
                      {site.siteId ?? pickByLocale(locale, S.unknownSite)}
                    </span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-medium text-foreground">
                    {site.headcount}
                  </p>
                  <p className="text-xs text-muted-foreground">{pickByLocale(locale, S.onShift)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Headcount error */}
      {headcountQuery.isError ? (
        <Alert variant="error">
          {headcountQuery.error instanceof ApiError
            ? headcountQuery.error.message
            : pickByLocale(locale, S.headcountError)}
        </Alert>
      ) : null}

      {/* Attendance history */}
      {!isLoading ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {pickByLocale(locale, S.recentTitle)}
          </h2>

          {attendanceQuery.isError ? (
            <Alert variant="error">
              {attendanceQuery.error instanceof ApiError
                ? attendanceQuery.error.message
                : pickByLocale(locale, S.attendanceError)}
            </Alert>
          ) : null}

          {!attendanceQuery.isError && records.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={pickByLocale(locale, S.emptyTitle)}
              description={pickByLocale(locale, S.intro)}
              action={
                <Link
                  href="/ask?prompt=staff+roster"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
                >
                  <Sparkles className="h-3 w-3" />
                  {pickByLocale(locale, S.emptyCta)}
                </Link>
              }
            />
          ) : null}

          {records.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{pickByLocale(locale, S.colWorker)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colSite)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colDate)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colClockIn)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colClockOut)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colEvent)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.userId.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.siteId ? row.siteId.slice(0, 12) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(row.workDate, locale)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {fmtTime(row.clockIn, locale)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {fmtTime(row.clockOut, locale)}
                    </TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">
                      {row.eventType}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </section>
      ) : null}

      {/* Brain delegation note */}
      <aside className="rounded-xl border border-border/60 bg-surface/30 p-4">
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.delegationNotePrefix)}{' '}
          <Link href="/mwikila" className="text-signal-500 hover:underline">
            Mr. Mwikila
          </Link>{' '}
          {pickByLocale(locale, S.delegationNoteSuffix)}
        </p>
      </aside>
    </div>
  );
}
