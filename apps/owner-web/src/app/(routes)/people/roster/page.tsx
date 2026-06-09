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
import {
  ArrowLeft,
  HardHat,
  Loader2,
  Sparkles,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';

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

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
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
      apiRequest<unknown>(
        '/api/v1/mining/attendance/headcount?groupBy=site',
        { signal },
      ),
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
    queryFn: ({ signal }) =>
      apiRequest<unknown>(
        '/api/v1/mining/attendance?limit=50',
        { signal },
      ),
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
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to People
        </Link>
      </div>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
            <Users className="h-3.5 w-3.5" />
            <span>People · Roster</span>
          </div>
          <h1 className="font-display text-2xl font-medium text-foreground">
            Worker roster
          </h1>
          <p className="text-sm text-neutral-400">
            Live per-site headcount and recent clock-in/out events.
          </p>
        </div>
        <Link
          href="/ask?prompt=roster"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ask Mr. Mwikila
        </Link>
      </header>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading roster…
        </div>
      ) : null}

      {/* Per-site headcount */}
      {!isLoading && headcountQuery.data ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Today's headcount
            {totalOnShift !== null ? (
              <span className="ml-2 font-mono text-xs text-signal-500">
                {totalOnShift} total
              </span>
            ) : null}
          </h2>
          {headcountQuery.data.perSite.length === 0 ? (
            <p className="text-sm text-neutral-400">
              No clock-in events recorded today.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {headcountQuery.data.perSite.map((site) => (
                <div
                  key={site.siteId ?? 'unknown'}
                  className="rounded-xl border border-border bg-surface/40 p-4"
                >
                  <div className="flex items-center gap-2">
                    <HardHat className="h-4 w-4 text-signal-500" />
                    <span className="font-mono text-xs text-neutral-400">
                      {site.siteId ?? 'Unknown site'}
                    </span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-medium text-foreground">
                    {site.headcount}
                  </p>
                  <p className="text-xs text-neutral-500">on shift</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Headcount error */}
      {headcountQuery.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-xs text-destructive">
            {headcountQuery.error instanceof ApiError
              ? headcountQuery.error.message
              : 'Could not load headcount data.'}
          </p>
        </div>
      ) : null}

      {/* Attendance history */}
      {!isLoading ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Recent attendance
          </h2>

          {attendanceQuery.isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-xs text-destructive">
                {attendanceQuery.error instanceof ApiError
                  ? attendanceQuery.error.message
                  : 'Could not load attendance history.'}
              </p>
            </div>
          ) : null}

          {!attendanceQuery.isError && records.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface/40 p-6 text-center">
              <Users className="mx-auto h-8 w-8 text-neutral-500" />
              <p className="mt-2 text-sm text-neutral-400">
                No attendance records found.
              </p>
              <Link
                href="/ask?prompt=staff+roster"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
              >
                <Sparkles className="h-3 w-3" />
                Ask Mr. Mwikila to show the roster
              </Link>
            </div>
          ) : null}

          {records.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
                <div className="col-span-3">Worker</div>
                <div className="col-span-2">Site</div>
                <div className="col-span-2">Date</div>
                <div className="col-span-2">Clock in</div>
                <div className="col-span-2">Clock out</div>
                <div className="col-span-1">Event</div>
              </div>
              <ul className="divide-y divide-border/60">
                {records.map((row) => (
                  <li
                    key={row.id}
                    className="grid grid-cols-1 gap-2 px-5 py-3 text-sm md:grid-cols-12 md:items-center md:gap-4"
                  >
                    <div className="col-span-3 font-mono text-xs text-neutral-300">
                      {row.userId.slice(0, 8)}…
                    </div>
                    <div className="col-span-2 text-xs text-neutral-400">
                      {row.siteId ? row.siteId.slice(0, 12) : '—'}
                    </div>
                    <div className="col-span-2 text-xs text-neutral-400">
                      {fmtDate(row.workDate)}
                    </div>
                    <div className="col-span-2 font-mono text-xs text-foreground">
                      {fmtTime(row.clockIn)}
                    </div>
                    <div className="col-span-2 font-mono text-xs text-foreground">
                      {fmtTime(row.clockOut)}
                    </div>
                    <div className="col-span-1 text-xs capitalize text-neutral-400">
                      {row.eventType}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Brain delegation note */}
      <aside className="rounded-xl border border-border/60 bg-surface/30 p-4">
        <p className="text-xs text-neutral-400">
          Full per-worker details (contracts, payslips, disciplinary history)
          are managed via{' '}
          <Link
            href="/mwikila"
            className="text-signal-500 hover:underline"
          >
            Mr. Mwikila
          </Link>{' '}
          using the org-admin brain tools.
        </p>
      </aside>
    </div>
  );
}
