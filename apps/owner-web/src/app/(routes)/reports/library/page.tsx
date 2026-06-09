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
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';

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

const KIND_LABELS: Record<string, string> = {
  daily: 'Daily owner brief',
  weekly: 'Weekly strategy memo',
  monthly: 'Monthly business review',
  investor: 'Investor / bank pack',
  board: 'Board pack',
  audit: 'Audit pack',
  'community-update': 'Community update',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function useReportLibrary(limit = 50) {
  return useQuery({
    queryKey: ['mining', 'reports', 'library', limit],
    queryFn: ({ signal }) =>
      apiRequest<unknown>(
        `/api/v1/mining/reports?limit=${limit}`,
        { signal },
      ),
    select: (raw): ReadonlyArray<ReportVersion> => {
      if (Array.isArray(raw)) {
        return z.array(ReportVersionSchema).parse(raw);
      }
      // envelope shape
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
  const { data, isLoading, isError, error } = useReportLibrary();
  const versions = data ?? [];

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Back */}
      <div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Reports
        </Link>
      </div>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
            <FileText className="h-3.5 w-3.5" />
            <span>Reports · Library</span>
          </div>
          <h1 className="font-display text-2xl font-medium text-foreground">
            Report library
          </h1>
          <p className="text-sm text-neutral-400">
            All generated reports for your estate, newest first. Each report
            includes a hash anchor for every figure — traceable to the source
            ledger or document chunk.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
          >
            <FileText className="h-3.5 w-3.5" />
            Generate new report
          </Link>
          <Link
            href="/ask?prompt=reports"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ask about analytics
          </Link>
        </div>
      </header>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading report library…
        </div>
      ) : null}

      {/* Error */}
      {isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-xs text-destructive">
            {error instanceof ApiError
              ? error.message
              : 'Could not load the report library.'}
          </p>
        </div>
      ) : null}

      {/* Empty */}
      {!isLoading && !isError && versions.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface/40 p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-neutral-500" />
          <p className="mt-3 text-sm font-medium text-foreground">
            No reports generated yet
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Use the report generator to produce your first daily brief, monthly
            review, or board pack.
          </p>
          <Link
            href="/reports"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
          >
            <FileText className="h-3.5 w-3.5" />
            Generate your first report
          </Link>
        </div>
      ) : null}

      {/* Report list */}
      {versions.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
            <div className="col-span-4">Type</div>
            <div className="col-span-3">Generated</div>
            <div className="col-span-2">Version</div>
            <div className="col-span-3 text-right">Actions</div>
          </div>
          <ul className="divide-y divide-border/60">
            {versions.map((v) => (
              <li
                key={v.id}
                className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="col-span-4">
                  <p className="text-sm font-medium text-foreground">
                    {kindLabel(v.renderKind)}
                  </p>
                  <p className="mt-0.5 font-mono text-tiny text-neutral-500">
                    {v.reportInstanceId.slice(0, 12)}…
                  </p>
                </div>
                <div className="col-span-3 text-xs text-neutral-400">
                  {fmtDate(v.generatedAt)}
                </div>
                <div className="col-span-2 font-mono text-xs text-neutral-400">
                  {v.version !== null ? `v${v.version}` : '—'}
                </div>
                <div className="col-span-3 flex justify-start gap-3 md:justify-end">
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
                    className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-foreground"
                  >
                    <Sparkles className="h-3 w-3" />
                    Discuss
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
