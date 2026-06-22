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
import { Button, FormField, Input, Skeleton, Alert } from '@borjie/design-system';
import { apiRequest, ApiError } from '@/lib/api-client';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { fmtDateForLocale } from '@/lib/format';
import { useLocale, type Locale } from '@/lib/locale';
import { compliancePackPageStrings as S } from '@/i18n/strings/compliance-pack-page';

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

function statusLabel(status: string, locale: Locale): string {
  if (status === 'scheduled') return S.statusQueued[locale];
  if (status === 'generating') return S.statusGenerating[locale];
  if (status === 'generated') return S.statusReady[locale];
  if (status === 'failed') return S.statusFailed[locale];
  return status;
}

function statusClass(status: string): string {
  if (status === 'generated') return 'text-success border-success/40 bg-success-subtle';
  if (status === 'failed') return 'text-danger border-danger/40 bg-danger-subtle';
  if (status === 'generating') return 'text-info border-info/40 bg-info-subtle';
  return 'text-muted-foreground border-border bg-surface';
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
        err instanceof ApiError ? err.message : S.scheduleFailed[locale],
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
    const effectiveLabel = label.trim() || S.defaultPackLabel(period)[locale];
    const result = CreateExportSchema.safeParse({
      label: effectiveLabel,
      regulators: [...selectedRegs],
      period,
    });
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? S.invalidInput[locale]);
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
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {S.backToCompliance[locale]}
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <FileCheck className="h-3.5 w-3.5" />
          <span>{S.eyebrow[locale]}</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          {S.title[locale]}
        </h1>
        <p className="text-sm text-muted-foreground">{S.subtitle[locale]}</p>
      </header>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface/40 p-6"
      >
        <h2 className="text-sm font-semibold text-foreground">
          {S.scheduleNewPack[locale]}
        </h2>

        {/* Period */}
        <FormField label={S.periodLabel[locale]} htmlFor="pack-period">
          <Input
            id="pack-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            required
            className="w-48"
          />
        </FormField>

        {/* Label */}
        <FormField
          label={`${S.labelLabel[locale]} ${S.optional[locale]}`}
          htmlFor="pack-label"
        >
          <Input
            id="pack-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={S.defaultPackLabel(period)[locale]}
            maxLength={120}
            className="max-w-sm"
          />
        </FormField>

        {/* Regulators */}
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-foreground">
            {S.includeRegulators[locale]}
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
                      : 'border-border text-muted-foreground hover:border-signal-500/40 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {selectedRegs.length === 0 ? (
            <p className="mt-1 text-xs text-warning">
              {S.selectAtLeastOne[locale]}
            </p>
          ) : null}
        </fieldset>

        {formError ? (
          <p className="text-xs text-danger">{formError}</p>
        ) : null}

        {successId ? (
          <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success-subtle px-4 py-3 text-xs text-success">
            <Package className="h-4 w-4 shrink-0" />
            {S.packQueued[locale]}
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
            {S.schedulePack[locale]}
          </Button>
          <Link
            href="/ask?prompt=compliance+pack"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {S.askCta[locale]}
          </Link>
        </div>
      </form>

      {/* Previous packs */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          {S.previousPacks[locale]}
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl border border-border" />
            <Skeleton className="h-14 rounded-xl border border-border" />
          </div>
        ) : null}

        {isError ? (
          <Alert variant="error">
            {S.loadFailed[locale]}
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void refetch()}
              className="ml-2 h-auto p-0 text-xs underline hover:no-underline"
            >
              {S.retry[locale]}
            </Button>
          </Alert>
        ) : null}

        {!isLoading && !isError && exports.length === 0 ? (
          <ScreenEmptyState
            icon={<Package className="h-6 w-6" />}
            title={S.noPacksYet[locale]}
            description={S.subtitle[locale]}
          />
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
                    {row.label ?? S.defaultRowLabel[locale]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(row.createdAt, locale)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-badge font-medium ${statusClass(row.status)}`}
                  >
                    {statusLabel(row.status, locale)}
                  </span>
                  {row.status === 'generated' && row.downloadUrl ? (
                    <a
                      href={row.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-signal-500 hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {S.download[locale]}
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
