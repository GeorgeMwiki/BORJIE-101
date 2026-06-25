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
import {
  Button,
  Alert,
  Input,
  FormField,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import {
  useExpansionAnalyze,
  useExpansionRecommend,
  type CurrencyCode,
  type ExpansionKind,
  type ExpansionScenarioInput,
  type ScenarioOutcome,
} from '@/lib/queries/capacity-expansion';
import { formatCurrency } from '@borjie/api-client';
import { pickByLocale } from '@/lib/locale-shared';
import { bcp47For } from '@/lib/format';
import { enumLabel } from '@/components/owner-os/panels/enum-label';
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

  // Money renders through `formatCurrency(amount, currency)` keyed on the
  // SUPPLIED currency code, with the Intl tag resolved from the user's
  // active locale via `bcp47For` — never a hard-coded per-currency literal.
  const fmtMoney = useMemo(
    () => (value: number) =>
      formatCurrency(value, currency, { locale: bcp47For(locale) }),
    [currency, locale],
  );

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
          <FormField label={pickByLocale(locale, M.currency)} className="space-y-1">
            <Select
              value={currency}
              onValueChange={(v) => setCurrency(v as CurrencyCode)}
            >
              <SelectTrigger aria-label={pickByLocale(locale, M.currency)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={pickByLocale(locale, M.discountRate)} className="space-y-1">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={discountRatePct}
              aria-label={pickByLocale(locale, M.discountRate)}
              onChange={(e) =>
                setDiscountRatePct(
                  Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                )
              }
            />
          </FormField>
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
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isSw ? M.scenario.sw : M.scenario.en} {i + 1}
              </h3>
              <button
                type="button"
                onClick={() => removeDraft(d.id)}
                disabled={drafts.length <= 1}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isSw ? M.remove.sw : M.remove.en}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label={pickByLocale(locale, M.label)} className="space-y-1">
                <Input
                  type="text"
                  value={d.label}
                  placeholder={pickByLocale(locale, M.labelPlaceholder)}
                  aria-label={pickByLocale(locale, M.label)}
                  onChange={(e) => updateDraft(d.id, { label: e.target.value })}
                />
              </FormField>
              <FormField label={pickByLocale(locale, M.kind)} className="space-y-1">
                <Select
                  value={d.kind}
                  onValueChange={(v) =>
                    updateDraft(d.id, { kind: v as ExpansionKind })
                  }
                >
                  <SelectTrigger aria-label={pickByLocale(locale, M.kind)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                label={
                  isSw ? M.upfrontCapex.sw(currency) : M.upfrontCapex.en(currency)
                }
                className="space-y-1"
              >
                <Input
                  type="number"
                  min={0}
                  value={d.upfrontCapex}
                  aria-label={
                    isSw ? M.upfrontCapex.sw(currency) : M.upfrontCapex.en(currency)
                  }
                  onChange={(e) =>
                    updateDraft(d.id, { upfrontCapex: e.target.value })
                  }
                />
              </FormField>
              <FormField
                label={pickByLocale(locale, M.cashflows)}
                className="space-y-1 sm:col-span-2"
              >
                <Input
                  type="text"
                  value={d.cashflows}
                  placeholder="120000, 140000, 160000"
                  aria-label={pickByLocale(locale, M.cashflows)}
                  onChange={(e) =>
                    updateDraft(d.id, { cashflows: e.target.value })
                  }
                />
              </FormField>
              <FormField
                label={pickByLocale(locale, M.tonnesPerYear)}
                className="space-y-1"
              >
                <Input
                  type="number"
                  min={0}
                  value={d.tonnesPerYear}
                  aria-label={pickByLocale(locale, M.tonnesPerYear)}
                  onChange={(e) =>
                    updateDraft(d.id, { tonnesPerYear: e.target.value })
                  }
                />
              </FormField>
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
            <span className="text-xs text-muted-foreground">
              {isSw ? M.enterCapexHint.sw : M.enterCapexHint.en}
            </span>
          ) : null}
        </div>
      </div>

      {analyze.isError ? (
        <Alert variant="error">{pickByLocale(locale, M.analysisFailed)}</Alert>
      ) : null}

      {/* Outcomes */}
      {analysis ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-signal-500" />
              {isSw ? M.outcomesRanked.sw : M.outcomesRanked.en}
            </h2>
            <span className="font-mono text-xs text-muted-foreground">
              {currency} · {(analysis.discountRate * 100).toFixed(1)}%
            </span>
          </header>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isSw ? M.scenario.sw : M.scenario.en}</TableHead>
                <TableHead>NPV</TableHead>
                <TableHead>IRR</TableHead>
                <TableHead>{isSw ? M.payback.sw : M.payback.en}</TableHead>
                <TableHead>{isSw ? M.tonnes.sw : M.tonnes.en}</TableHead>
                <TableHead>CapEx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedOutcomes(analysis.outcomes, analysis.rankedByNpv).map(
                (o: ScenarioOutcome) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        {o.id === topId ? (
                          <Trophy className="h-3.5 w-3.5 text-warning" />
                        ) : null}
                        {o.label}
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        {enumLabel('expansionKind', o.kind, locale)}
                      </div>
                    </TableCell>
                    <TableCell
                      className={`font-mono ${
                        o.npv >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {fmtMoney(o.npv)}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {fmtPct(o.irr)}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {fmtPayback(o.paybackYears)}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {Math.round(o.totalIncrementalTonnes).toLocaleString(
                        bcp47For(locale),
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {fmtMoney(o.upfrontCapex)}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
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
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isSw ? M.recommendationsSubtitle.sw : M.recommendationsSubtitle.en}
            </p>
          </header>
          {recommend.data.recommendations.length === 0 ? (
            <div className="px-5 py-6 text-xs text-muted-foreground">
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
                          : 'border-border bg-surface text-muted-foreground'
                      }`}
                    >
                      {enumLabel('alertSeverity', r.severity, locale)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {r.rationale}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.evidence.map((ev) => (
                      <span
                        key={ev.id}
                        className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-spark text-muted-foreground"
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
