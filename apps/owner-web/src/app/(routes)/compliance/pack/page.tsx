'use client';

/**
 * O-W-14-PACK — Monthly compliance pack surface.
 *
 * Drafts a compliance export (POST /api/v1/compliance/exports) and
 * lists previously generated packs (GET /api/v1/compliance). Covers
 * the Mining Commission monthly obligations pack. Status lifecycle:
 *   scheduled → generated → ready for download.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  FileCheck,
  Loader2,
  Package,
  Sparkles,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@borjie/design-system';
import { apiRequest, ApiError } from '@/lib/api-client';
import { fmtDateForLocale } from '@/lib/format';
import { useLocale, type Locale } from '@/lib/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ExportRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  createdAt: z.string(),
  downloadUrl: z.string().nullable().optional(),
  label: z.string().optional(),
});

type ExportRow = z.infer<typeof ExportRowSchema>;

const ExportsListSchema = z.object({
  success: z.literal(true),
  data: z.object({
    exports: z.array(ExportRowSchema),
    count: z.number(),
  }),
});

// Gateway accepts: label, regulators[], period
const CreateExportSchema = z.object({
  label: z.string().min(1),
  regulators: z.array(z.string()).min(1),
  period: z.string().min(1),
});

type CreateExportInput = z.infer<typeof CreateExportSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REGULATOR_OPTIONS = [
  { value: 'MC', label: 'Mining Commission' },
  { value: 'NEMC', label: 'NEMC — Environment' },
  { value: 'BoT', label: 'Bank of Tanzania' },
  { value: 'TRA', label: 'Tanzania Revenue Authority' },
  { value: 'OSHA', label: 'OSHA — Workplace Safety' },
];

const QUERY_KEY = ['compliance', 'exports'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Locale-aware — never a hardcoded 'en-GB'. The BCP-47 tag follows the
// user's active locale (locale-follows-the-user canon).
function fmtDate(iso: string, locale: Locale): string {
  try {
    return fmtDateForLocale(iso, locale);
  } catch {
    return iso;
  }
}

function statusLabel(status: string): string {
  if (status === 'scheduled') return 'Queued';
  if (status === 'generating') return 'Generating…';
  if (status === 'generated') return 'Ready';
  if (status === 'failed') return 'Failed';
  return status;
}

function statusClass(status: string): string {
  if (status === 'generated') return 'text-success border-success/40 bg-success/10';
  if (status === 'failed') return 'text-destructive border-destructive/40 bg-destructive/10';
  if (status === 'generating') return 'text-info border-info/40 bg-info/10';
  return 'text-neutral-300 border-border bg-surface';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CompliancePackPage() {
  const queryClient = useQueryClient();
  const locale = useLocale();

  // Form state
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [period, setPeriod] = useState(defaultPeriod);
  const [label, setLabel] = useState('');
  const [selectedRegs, setSelectedRegs] = useState<ReadonlyArray<string>>([
    'MC',
    'TRA',
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  // List query
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/compliance/exports', { signal }),
    select: (raw): ReadonlyArray<ExportRow> => {
      const parsed = ExportsListSchema.safeParse(raw);
      if (!parsed.success) return [];
      return parsed.data.data.exports;
    },
    staleTime: 30_000,
  });

  // Create mutation
  const mutation = useMutation({
    mutationFn: (input: CreateExportInput) =>
      apiRequest<unknown>('/api/v1/compliance/exports', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (raw) => {
      const id =
        raw && typeof raw === 'object' && 'id' in raw
          ? String((raw as Record<string, unknown>).id)
          : null;
      setSuccessId(id ?? 'queued');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: unknown) => {
      setFormError(
        err instanceof ApiError ? err.message : 'Could not schedule the pack. Please retry.',
      );
    },
  });

  function handleToggleRegulator(value: string) {
    setSelectedRegs((prev) =>
      prev.includes(value)
        ? prev.filter((r) => r !== value)
        : [...prev, value],
    );
    setFormError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessId(null);
    const effectiveLabel = label.trim() || `${period} compliance pack`;
    const result = CreateExportSchema.safeParse({
      label: effectiveLabel,
      regulators: [...selectedRegs],
      period,
    });
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    mutation.mutate(result.data);
  }

  const exports = data ?? [];

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Back navigation */}
      <div>
        <Link
          href="/compliance"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Compliance
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <FileCheck className="h-3.5 w-3.5" />
          <span>Compliance · Monthly pack</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          Draft monthly pack
        </h1>
        <p className="text-sm text-neutral-400">
          Generate a compliance export bundle for one or more regulators.
          The pack is assembled by the consolidation worker and becomes
          available for download within minutes.
        </p>
      </header>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface/40 p-6"
      >
        <h2 className="text-sm font-semibold text-foreground">
          Schedule a new pack
        </h2>

        {/* Period */}
        <div className="space-y-1">
          <label
            htmlFor="pack-period"
            className="text-xs font-medium text-neutral-300"
          >
            Period (YYYY-MM)
          </label>
          <input
            id="pack-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            required
            className="w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-signal-500/50"
          />
        </div>

        {/* Label */}
        <div className="space-y-1">
          <label
            htmlFor="pack-label"
            className="text-xs font-medium text-neutral-300"
          >
            Label{' '}
            <span className="text-neutral-500">(optional)</span>
          </label>
          <input
            id="pack-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`${period} compliance pack`}
            maxLength={120}
            className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-signal-500/50"
          />
        </div>

        {/* Regulators */}
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-neutral-300">
            Include regulators
          </legend>
          <div className="flex flex-wrap gap-2">
            {REGULATOR_OPTIONS.map((opt) => {
              const selected = selectedRegs.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleToggleRegulator(opt.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? 'border-signal-500/60 bg-signal-500/10 text-signal-500'
                      : 'border-border text-neutral-300 hover:border-signal-500/40 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {selectedRegs.length === 0 ? (
            <p className="mt-1 text-xs text-warning">
              Select at least one regulator.
            </p>
          ) : null}
        </fieldset>

        {formError ? (
          <p className="text-xs text-destructive">{formError}</p>
        ) : null}

        {successId ? (
          <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-xs text-success">
            <Package className="h-4 w-4 shrink-0" />
            Pack queued. It will appear in the list below once generated.
          </div>
        ) : null}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={mutation.isPending || selectedRegs.length === 0}
            className="gap-2"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileCheck className="h-3.5 w-3.5" />
            )}
            Schedule pack
          </Button>
          <Link
            href="/ask?prompt=compliance+pack"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ask Mr. Mwikila
          </Link>
        </div>
      </form>

      {/* Previous packs */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Previous packs
        </h2>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : null}

        {isError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-xs text-destructive">
              Could not load previous packs.
            </p>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void refetch()}
              className="mt-1 h-auto p-0 text-xs text-destructive underline hover:no-underline"
            >
              Retry
            </Button>
          </div>
        ) : null}

        {!isLoading && !isError && exports.length === 0 ? (
          <p className="text-sm text-neutral-400">
            No packs yet. Schedule the first one above.
          </p>
        ) : null}

        {exports.length > 0 ? (
          <ul className="space-y-2">
            {exports.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {row.label ?? 'Compliance pack'}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {fmtDate(row.createdAt, locale)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-badge font-medium ${statusClass(row.status)}`}
                  >
                    {statusLabel(row.status)}
                  </span>
                  {row.status === 'generated' && row.downloadUrl ? (
                    <a
                      href={row.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-signal-500 hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
