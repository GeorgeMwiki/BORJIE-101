'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3,
  Coins,
  Lightbulb,
  Loader2,
  Plus,
  Trash2,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { Button } from '@borjie/design-system';
import {
  useExpansionAnalyze,
  useExpansionRecommend,
  type CurrencyCode,
  type ExpansionKind,
  type ExpansionScenarioInput,
  type ScenarioOutcome,
} from '@/lib/queries/capacity-expansion';
import { capacityExpansionPanelStrings as M } from '@/i18n/strings/capacity-expansion-panel';

interface CapacityExpansionPanelProps {
  readonly locale?: 'sw' | 'en';
}

const CURRENCIES: ReadonlyArray<CurrencyCode> = ['TZS', 'USD', 'EUR', 'GBP'];
const KINDS: ReadonlyArray<ExpansionKind> = [
  'new-shaft',
  'new-site',
  'processing-upgrade',
];

/** Locale tag per currency — drives Intl grouping/symbol. Never hard-codes
 *  a single currency: the formatter is built from the supplied code. */
function localeForCurrency(currency: CurrencyCode): string {
  switch (currency) {
    case 'TZS':
      return 'en-TZ';
    case 'EUR':
      return 'de-DE';
    case 'GBP':
      return 'en-GB';
    default:
      return 'en-US';
  }
}

function makeMoneyFmt(currency: CurrencyCode): Intl.NumberFormat {
  return new Intl.NumberFormat(localeForCurrency(currency), {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
}

interface DraftScenario {
  readonly id: string;
  readonly kind: ExpansionKind;
  readonly label: string;
  readonly upfrontCapex: string;
  readonly cashflows: string;
  readonly tonnesPerYear: string;
}

function emptyDraft(index: number): DraftScenario {
  return {
    id: `scenario-${index + 1}`,
    kind: 'new-shaft',
    label: '',
    upfrontCapex: '',
    cashflows: '',
    tonnesPerYear: '',
  };
}

function parseCashflows(raw: string): number[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

/**
 * Owner-cockpit capacity-expansion advisor surface.
 *
 * Lets the owner define expansion scenarios (upfront capex + year-by-year
 * incremental cashflows + tonnage uplift), pick a currency + discount
 * rate, then runs the pure-compute advisor via
 * `/api/v1/mining/capacity-expansion/analyze` to get NPV / IRR / payback
 * per scenario ranked by NPV, and `/recommend` for evidence-cited advice.
 * All money is rendered with an Intl formatter keyed on the SUPPLIED
 * currency code (no hard-coded currency).
 */
export function CapacityExpansionPanel({
  locale = 'en',
}: CapacityExpansionPanelProps): JSX.Element {
  const isSw = locale === 'sw';
  const [currency, setCurrency] = useState<CurrencyCode>('TZS');
  const [discountRatePct, setDiscountRatePct] = useState<number>(12);
  const [drafts, setDrafts] = useState<ReadonlyArray<DraftScenario>>([
    emptyDraft(0),
  ]);

  const analyze = useExpansionAnalyze();
  const recommend = useExpansionRecommend();

  const moneyFmt = useMemo(() => makeMoneyFmt(currency), [currency]);

  function updateDraft(id: string, patch: Partial<DraftScenario>) {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  }

  function addDraft() {
    setDrafts((prev) => [...prev, emptyDraft(prev.length)]);
  }

  function removeDraft(id: string) {
    setDrafts((prev) =>
      prev.length <= 1 ? prev : prev.filter((d) => d.id !== id),
    );
  }

  const validScenarios = useMemo<ReadonlyArray<ExpansionScenarioInput>>(() => {
    return drafts
      .map((d): ExpansionScenarioInput | null => {
        const capex = Number(d.upfrontCapex);
        const cashflows = parseCashflows(d.cashflows);
        if (!Number.isFinite(capex) || capex < 0) return null;
        if (cashflows.length === 0) return null;
        const tonnes = Number(d.tonnesPerYear);
        return {
          id: d.id,
          kind: d.kind,
          label: d.label.trim() || d.id,
          upfrontCapex: capex,
          incrementalCashflows: cashflows,
          incrementalTonnesPerYear:
            Number.isFinite(tonnes) && tonnes >= 0 ? tonnes : 0,
        };
      })
      .filter((s): s is ExpansionScenarioInput => s !== null);
  }, [drafts]);

  const canAnalyze = validScenarios.length > 0;

  function runAnalyze() {
    if (!canAnalyze) return;
    recommend.reset();
    analyze.mutate({
      currency,
      discountRate: Math.min(1, Math.max(0, discountRatePct / 100)),
      scenarios: validScenarios,
    });
  }

  function runRecommend() {
    if (!analyze.data) return;
    recommend.mutate({
      analysis: analyze.data.analysis,
      policy: { minNpv: 0, maxPaybackYears: 5 },
    });
  }

  const analysis = analyze.data?.analysis;
  const topId = analysis?.rankedByNpv[0];

  function fmtMoney(n: number): string {
    return moneyFmt.format(n);
  }
  function fmtPct(ratio: number | null): string {
    return ratio === null
      ? isSw
        ? M.pctNa.sw
        : M.pctNa.en
      : `${(ratio * 100).toFixed(1)}%`;
  }
  function fmtPayback(years: number | null): string {
    return years === null
      ? isSw
        ? M.paybackBeyond.sw
        : M.paybackBeyond.en
      : `${years.toFixed(1)} ${isSw ? M.yearAbbr.sw : M.yearAbbr.en}`;
  }

  return (
    <div className="space-y-6">
      {/* Global params */}
      <div className="rounded-2xl border border-border bg-surface/40 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Coins className="h-4 w-4 text-signal-500" />
          {isSw ? M.analysisParams.sw : M.analysisParams.en}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {isSw ? M.currency.sw : M.currency.en}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {isSw ? M.discountRate.sw : M.discountRate.en}
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={discountRatePct}
              onChange={(e) =>
                setDiscountRatePct(
                  Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                )
              }
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>
      </div>

      {/* Scenario drafts */}
      <div className="space-y-4">
        {drafts.map((d, i) => (
          <div
            key={d.id}
            className="rounded-2xl border border-border bg-surface/30 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {isSw ? M.scenario.sw : M.scenario.en} {i + 1}
              </h3>
              <button
                type="button"
                onClick={() => removeDraft(d.id)}
                disabled={drafts.length <= 1}
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isSw ? M.remove.sw : M.remove.en}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-neutral-400">
                {isSw ? M.label.sw : M.label.en}
                <input
                  type="text"
                  value={d.label}
                  placeholder={isSw ? M.labelPlaceholder.sw : M.labelPlaceholder.en}
                  onChange={(e) => updateDraft(d.id, { label: e.target.value })}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-400">
                {isSw ? M.kind.sw : M.kind.en}
                <select
                  value={d.kind}
                  onChange={(e) =>
                    updateDraft(d.id, { kind: e.target.value as ExpansionKind })
                  }
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-400">
                {isSw ? M.upfrontCapex.sw(currency) : M.upfrontCapex.en(currency)}
                <input
                  type="number"
                  min={0}
                  value={d.upfrontCapex}
                  onChange={(e) =>
                    updateDraft(d.id, { upfrontCapex: e.target.value })
                  }
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-400 sm:col-span-2">
                {isSw ? M.cashflows.sw : M.cashflows.en}
                <input
                  type="text"
                  value={d.cashflows}
                  placeholder="120000, 140000, 160000"
                  onChange={(e) =>
                    updateDraft(d.id, { cashflows: e.target.value })
                  }
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-400">
                {isSw ? M.tonnesPerYear.sw : M.tonnesPerYear.en}
                <input
                  type="number"
                  min={0}
                  value={d.tonnesPerYear}
                  onChange={(e) =>
                    updateDraft(d.id, { tonnesPerYear: e.target.value })
                  }
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addDraft}
            className="gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            {isSw ? M.addScenario.sw : M.addScenario.en}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canAnalyze || analyze.isPending}
            onClick={runAnalyze}
            className="gap-2"
          >
            {analyze.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BarChart3 className="h-3.5 w-3.5" />
            )}
            {isSw ? M.analyze.sw : M.analyze.en}
          </Button>
          {!canAnalyze ? (
            <span className="text-xs text-neutral-500">
              {isSw ? M.enterCapexHint.sw : M.enterCapexHint.en}
            </span>
          ) : null}
        </div>
      </div>

      {analyze.isError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-xs text-destructive">
          {isSw ? M.analysisFailed.sw : M.analysisFailed.en}
        </div>
      ) : null}

      {/* Outcomes */}
      {analysis ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-signal-500" />
              {isSw ? M.outcomesRanked.sw : M.outcomesRanked.en}
            </h2>
            <span className="font-mono text-xs text-neutral-400">
              {currency} · {(analysis.discountRate * 100).toFixed(1)}%
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-neutral-500">
                  <th className="px-5 py-3 font-medium">
                    {isSw ? M.scenario.sw : M.scenario.en}
                  </th>
                  <th className="px-3 py-3 font-medium">NPV</th>
                  <th className="px-3 py-3 font-medium">IRR</th>
                  <th className="px-3 py-3 font-medium">
                    {isSw ? M.payback.sw : M.payback.en}
                  </th>
                  <th className="px-3 py-3 font-medium">
                    {isSw ? M.tonnes.sw : M.tonnes.en}
                  </th>
                  <th className="px-5 py-3 font-medium">CapEx</th>
                </tr>
              </thead>
              <tbody>
                {orderedOutcomes(analysis.outcomes, analysis.rankedByNpv).map(
                  (o: ScenarioOutcome) => (
                    <tr
                      key={o.id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          {o.id === topId ? (
                            <Trophy className="h-3.5 w-3.5 text-warning" />
                          ) : null}
                          {o.label}
                        </div>
                        <div className="mt-0.5 text-neutral-500">{o.kind}</div>
                      </td>
                      <td
                        className={`px-3 py-3 font-mono ${
                          o.npv >= 0 ? 'text-success' : 'text-destructive'
                        }`}
                      >
                        {fmtMoney(o.npv)}
                      </td>
                      <td className="px-3 py-3 font-mono text-neutral-300">
                        {fmtPct(o.irr)}
                      </td>
                      <td className="px-3 py-3 font-mono text-neutral-300">
                        {fmtPayback(o.paybackYears)}
                      </td>
                      <td className="px-3 py-3 font-mono text-neutral-300">
                        {Math.round(o.totalIncrementalTonnes).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 font-mono text-neutral-400">
                        {fmtMoney(o.upfrontCapex)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 border-t border-border px-5 py-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={recommend.isPending}
              onClick={runRecommend}
              className="gap-2"
            >
              {recommend.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lightbulb className="h-3.5 w-3.5 text-signal-500" />
              )}
              {isSw ? M.getRecommendations.sw : M.getRecommendations.en}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Recommendations (evidence-cited) */}
      {recommend.data ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
          <header className="border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Lightbulb className="h-4 w-4 text-signal-500" />
              {isSw ? M.recommendations.sw : M.recommendations.en}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              {isSw ? M.recommendationsSubtitle.sw : M.recommendationsSubtitle.en}
            </p>
          </header>
          {recommend.data.recommendations.length === 0 ? (
            <div className="px-5 py-6 text-xs text-neutral-500">
              {isSw ? M.noScenarioCleared.sw : M.noScenarioCleared.en}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {recommend.data.recommendations.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {r.title}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-badge font-medium ${
                        r.severity === 'medium'
                          ? 'border-warning/40 bg-warning/10 text-warning'
                          : 'border-border bg-surface text-neutral-300'
                      }`}
                    >
                      {r.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                    {r.rationale}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.evidence.map((ev) => (
                      <span
                        key={ev.id}
                        className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-spark text-neutral-500"
                      >
                        {ev.id}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Order outcomes by the advisor's NPV ranking (rankedByNpv ids). */
function orderedOutcomes(
  outcomes: ReadonlyArray<ScenarioOutcome>,
  ranked: ReadonlyArray<string>,
): ReadonlyArray<ScenarioOutcome> {
  const byId = new Map(outcomes.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const out: ScenarioOutcome[] = [];
  for (const id of ranked) {
    const o = byId.get(id);
    if (o) {
      out.push(o);
      seen.add(id);
    }
  }
  for (const o of outcomes) {
    if (!seen.has(o.id)) out.push(o);
  }
  return out;
}
