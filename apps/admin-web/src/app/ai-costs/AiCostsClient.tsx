'use client';

/**
 * AI spend monitor — migrated from apps/admin-portal/src/pages/AiCosts.tsx.
 *
 *   GET /api/v1/ai-costs/summary  — current-month totals + per-model breakdown
 *   GET /api/v1/ai-costs/entries  — recent LLM call entries
 *   GET /api/v1/ai-costs/budget   — monthly cap (null if unset)
 *   PUT /api/v1/ai-costs/budget   — admin sets cap
 *
 * Cost figures come back as USD-micro (1e-6 USD); the underlying provider
 * billing is denominated in USD, so the "$" here is the DATA unit (not a
 * jurisdictional currency literal) and stays verbatim across locales.
 *
 * Rendered on design-system primitives + semantic tokens so the screen
 * lives correctly inside the dark admin shell. SINGLE LANGUAGE PER LOCALE
 * (canon): every user-facing string resolves to the active locale via
 * `pickByLocale`. This is a purely client surface (no server-seeded
 * locale prop), so the hook falls back to the project default and the
 * post-mount effect corrects it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Coins, DollarSign, AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  FormField,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Empty,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale } from '@/lib/locale';

interface ModelBreakdownRow {
  readonly model: string;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsdMicro: number;
}

interface Summary {
  readonly totalCostUsdMicro: number;
  readonly totalCalls: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly perModel: readonly ModelBreakdownRow[];
}

interface Budget {
  readonly monthlyCapUsdMicro: number;
  readonly hardStop: boolean;
  readonly updatedAt?: string;
}

interface SummaryResponse {
  readonly summary: Summary;
  readonly budget: Budget | null;
  readonly overBudget: boolean;
}

interface Entry {
  readonly id: string;
  readonly model: string;
  readonly costUsdMicro: number;
  readonly createdAt: string;
  readonly purpose?: string;
}

const S = {
  intro: {
    en: 'Per-model LLM spend across the platform.',
    sw: 'Matumizi ya LLM kwa kila modeli katika jukwaa zima.',
  },
  retry: { en: 'Retry', sw: 'Jaribu tena' },
  loadFailed: { en: 'Failed to load summary', sw: 'Imeshindwa kupakia muhtasari' },
  saveFailed: { en: 'Failed to save budget', sw: 'Imeshindwa kuhifadhi bajeti' },
  capInvalid: {
    en: 'Cap must be a non-negative number',
    sw: 'Kikomo lazima kiwe namba isiyo hasi',
  },
  overBudget: { en: 'Monthly budget exceeded.', sw: 'Bajeti ya mwezi imezidiwa.' },
  thisMonth: { en: 'This month', sw: 'Mwezi huu' },
  calls: { en: 'Calls', sw: 'Miito' },
  cap: { en: 'Cap', sw: 'Kikomo' },
  perModel: { en: 'Per model', sw: 'Kwa kila modeli' },
  colModel: { en: 'Model', sw: 'Modeli' },
  colPrompt: { en: 'Prompt tokens', sw: 'Tokeni za ombi' },
  colCompletion: { en: 'Completion tokens', sw: 'Tokeni za jibu' },
  colCost: { en: 'Cost', sw: 'Gharama' },
  noUsage: {
    en: 'No usage recorded this period.',
    sw: 'Hakuna matumizi yaliyorekodiwa kipindi hiki.',
  },
  monthlyCap: { en: 'Monthly cap', sw: 'Kikomo cha mwezi' },
  capUsd: { en: 'Cap (USD)', sw: 'Kikomo (USD)' },
  hardStop: {
    en: 'Hard stop when cap reached',
    sw: 'Simamisha kabisa kikomo kikifikiwa',
  },
  save: { en: 'Save', sw: 'Hifadhi' },
  recent: { en: 'Recent calls', sw: 'Miito ya hivi karibuni' },
  noRecentTitle: { en: 'No recent calls', sw: 'Hakuna miito ya hivi karibuni' },
  noRecentBody: {
    en: 'LLM calls will appear here as they are billed.',
    sw: 'Miito ya LLM itaonekana hapa inapotozwa.',
  },
} as const;

function dollars(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

export function AiCostsClient() {
  const locale = useLocale();
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftCap, setDraftCap] = useState('');
  const [hardStop, setHardStop] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, e] = await Promise.all([
      api.get<SummaryResponse>('/ai-costs/summary'),
      api.get<readonly Entry[]>('/ai-costs/entries'),
    ]);
    if (s.success && s.data) {
      setSummary(s.data);
      if (s.data.budget) {
        setDraftCap((s.data.budget.monthlyCapUsdMicro / 1_000_000).toString());
        setHardStop(s.data.budget.hardStop);
      }
    } else {
      setError(s.error ?? pickByLocale(locale, S.loadFailed));
    }
    if (e.success && e.data) setEntries(e.data);
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBudget(): Promise<void> {
    const capUsd = Number(draftCap);
    if (!Number.isFinite(capUsd) || capUsd < 0) {
      setError(pickByLocale(locale, S.capInvalid));
      return;
    }
    const res = await api.put('/ai-costs/budget', {
      monthlyCapUsdMicro: Math.round(capUsd * 1_000_000),
      hardStop,
    });
    if (res.success) {
      void load();
    } else {
      setError(res.error ?? pickByLocale(locale, S.saveFailed));
    }
  }

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={pickByLocale(locale, S.intro)}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg border border-border" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-lg border border-border" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Coins className="h-6 w-6 text-warning" />
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, S.intro)}
        </p>
      </header>

      {error && (
        <Alert
          variant="error"
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
            >
              {pickByLocale(locale, S.retry)}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {summary && (
        <>
          {summary.overBudget && (
            <Alert variant="warning">
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {pickByLocale(locale, S.overBudget)}
              </span>
            </Alert>
          )}

          <section className="grid gap-4 md:grid-cols-3">
            <StatCard
              label={pickByLocale(locale, S.thisMonth)}
              value={dollars(summary.summary.totalCostUsdMicro)}
            />
            <StatCard
              label={pickByLocale(locale, S.calls)}
              value={summary.summary.totalCalls.toLocaleString()}
            />
            <StatCard
              label={pickByLocale(locale, S.cap)}
              value={
                summary.budget ? dollars(summary.budget.monthlyCapUsdMicro) : '—'
              }
            />
          </section>

          <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong">
            <h3 className="mb-3 font-display text-foreground">
              {pickByLocale(locale, S.perModel)}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{pickByLocale(locale, S.colModel)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.calls)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colPrompt)}</TableHead>
                  <TableHead>{pickByLocale(locale, S.colCompletion)}</TableHead>
                  <TableHead className="text-right">
                    {pickByLocale(locale, S.colCost)}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.summary.perModel.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell className="font-medium text-foreground">
                      {row.model}
                    </TableCell>
                    <TableCell>{row.calls}</TableCell>
                    <TableCell>{row.promptTokens.toLocaleString()}</TableCell>
                    <TableCell>
                      {row.completionTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {dollars(row.costUsdMicro)}
                    </TableCell>
                  </TableRow>
                ))}
                {summary.summary.perModel.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-muted-foreground"
                    >
                      {pickByLocale(locale, S.noUsage)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="max-w-xl space-y-3 rounded-2xl p-6 transition-colors hover:border-border-strong">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-warning" />
              <h3 className="font-display text-foreground">
                {pickByLocale(locale, S.monthlyCap)}
              </h3>
            </div>
            <FormField label={pickByLocale(locale, S.capUsd)} name="cap">
              <Input
                type="number"
                min="0"
                step="1"
                value={draftCap}
                onChange={(e) => setDraftCap(e.target.value)}
                data-testid="ai-cost-cap"
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={hardStop}
                onChange={(e) => setHardStop(e.target.checked)}
                className="h-4 w-4 rounded border-border text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {pickByLocale(locale, S.hardStop)}
            </label>
            <Button type="button" onClick={() => void saveBudget()}>
              {pickByLocale(locale, S.save)}
            </Button>
          </Card>

          <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong">
            <h3 className="mb-3 font-display text-foreground">
              {pickByLocale(locale, S.recent)}
            </h3>
            {entries.length === 0 ? (
              <Empty
                title={pickByLocale(locale, S.noRecentTitle)}
                description={pickByLocale(locale, S.noRecentBody)}
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {entries.slice(0, 20).map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between border-b border-border/40 py-1 last:border-b-0"
                  >
                    <span>
                      <span className="font-medium text-foreground">
                        {e.model}
                      </span>
                      {e.purpose ? (
                        <span className="text-muted-foreground"> — {e.purpose}</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dollars(e.costUsdMicro)} ·{' '}
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl text-foreground">{value}</p>
    </Card>
  );
}
