'use client';

/**
 * FX & treasury advisor panel — owner treasury surface.
 *
 * Drives the real `@borjie/fx-treasury-advisor` via the mining BFF: the
 * owner supplies cash balances + scheduled cashflows (and optional
 * stockpiles / FX rates); the panel projects a day-by-day cash runway
 * (zero-crossing + min-balance), nets the multi-currency FX exposure,
 * persists the snapshot, then derives evidence-backed treasury
 * recommendations — runway-floor breach, currency concentration, and the
 * 27-Mar USD-cliff remediation playbook.
 *
 * Every money value renders through `formatCurrency(amount, currency)`
 * with the runway/exposure's OWN `baseCurrency` — never a hardcoded
 * literal. This IS the FX domain: currency is data end-to-end.
 */

import { useMemo, useState } from 'react';
import { Button } from '@borjie/design-system';
import { formatCurrency } from '@borjie/api-client';
import {
  useTreasuryAnalyze,
  useTreasuryRecommend,
  type CashBalanceInput,
  type CashflowCategory,
  type CashflowInput,
  type CurrencyCode,
  type TreasuryAnalyzeRequest,
  type TreasuryRecommendation,
  CURRENCY_CODES,
} from '@/lib/queries/treasury-advisor';
import { treasuryAdvisorPanelStrings as T } from '@/i18n/strings/treasury-advisor-panel';

interface TreasuryAdvisorPanelProps {
  readonly locale: 'sw' | 'en';
}

const CATEGORIES: ReadonlyArray<CashflowCategory> = [
  'payroll',
  'fuel',
  'royalty',
  'tax',
  'capex',
  'off-take',
  'loan-service',
  'other',
];

interface BalanceRow extends CashBalanceInput {
  readonly key: string;
}
interface FlowRow extends CashflowInput {
  readonly key: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function plusDaysISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const SEVERITY_TONE: Record<TreasuryRecommendation['severity'], string> = {
  info: 'border-border bg-surface text-foreground',
  low: 'border-border bg-surface text-foreground',
  medium: 'border-warning/40 bg-warning-subtle/20 text-warning',
  high: 'border-warning/40 bg-warning-subtle/20 text-warning',
  critical: 'border-danger/40 bg-danger-subtle/20 text-danger',
};

export function TreasuryAdvisorPanel({ locale }: TreasuryAdvisorPanelProps) {
  const tr = (k: keyof typeof T) => T[k][locale];

  const [baseCurrency, setBaseCurrency] = useState<CurrencyCode>('TZS');
  const [horizonDays, setHorizonDays] = useState('60');
  const [balances, setBalances] = useState<ReadonlyArray<BalanceRow>>([
    { key: crypto.randomUUID(), accountId: 'main-tzs', currency: 'TZS', balance: 500_000_000, asOfISO: todayISO() },
    { key: crypto.randomUUID(), accountId: 'usd-ops', currency: 'USD', balance: 40_000, asOfISO: todayISO() },
  ]);
  const [flows, setFlows] = useState<ReadonlyArray<FlowRow>>([
    { key: crypto.randomUUID(), id: 'payroll-1', direction: 'out', dueISO: plusDaysISO(7), amount: 120_000_000, currency: 'TZS', category: 'payroll' },
    { key: crypto.randomUUID(), id: 'offtake-1', direction: 'in', dueISO: plusDaysISO(20), amount: 90_000, currency: 'USD', category: 'off-take' },
  ]);

  const analyzeMut = useTreasuryAnalyze();
  const recommendMut = useTreasuryRecommend();

  const analysis = analyzeMut.data?.analysis;
  const lastRequest = useMemo<TreasuryAnalyzeRequest | null>(
    () => analyzeMut.variables ?? null,
    [analyzeMut.variables],
  );
  const recommendations = recommendMut.data?.recommendations;

  const fmt = useMemo(() => {
    const cur = analysis?.runway.baseCurrency ?? baseCurrency;
    return (value: number) =>
      formatCurrency(value, cur, { locale: locale === 'sw' ? 'sw-TZ' : 'en-US' });
  }, [analysis?.runway.baseCurrency, baseCurrency, locale]);

  function buildRequest(): TreasuryAnalyzeRequest {
    return {
      baseCurrency,
      horizonDays: Number(horizonDays) || 60,
      balances: balances.map(({ key, ...b }) => {
        void key;
        return b;
      }),
      cashflows: flows.map(({ key, ...f }) => {
        void key;
        return f;
      }),
    };
  }

  function onCompute() {
    recommendMut.reset();
    analyzeMut.mutate(buildRequest());
  }

  function onRecommend() {
    if (!analysis || !lastRequest) return;
    recommendMut.mutate({ analysis, input: lastRequest });
  }

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{tr('title')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">{tr('subtitle')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-400">{tr('base')}</span>
          <select
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-foreground"
            value={baseCurrency}
            onChange={(e) => setBaseCurrency(e.target.value as CurrencyCode)}
          >
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-400">{tr('horizon')}</span>
          <input
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-foreground"
            type="number"
            value={horizonDays}
            onChange={(e) => setHorizonDays(e.target.value)}
          />
        </label>
      </div>

      {/* Balances */}
      <Section
        title={tr('balances')}
        actionLabel={tr('addBalance')}
        onAdd={() =>
          setBalances((rows) => [
            ...rows,
            { key: crypto.randomUUID(), accountId: `acct-${rows.length + 1}`, currency: baseCurrency, balance: 0, asOfISO: todayISO() },
          ])
        }
      >
        {balances.map((b) => (
          <div key={b.key} className="flex flex-wrap items-center gap-2">
            <input
              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              value={b.accountId}
              onChange={(e) => setBalances((rows) => rows.map((r) => (r.key === b.key ? { ...r, accountId: e.target.value } : r)))}
            />
            <CurrencySelect
              value={b.currency}
              onChange={(c) => setBalances((rows) => rows.map((r) => (r.key === b.key ? { ...r, currency: c } : r)))}
            />
            <input
              className="w-40 rounded-md border border-border bg-background px-2 py-1 text-right text-xs text-foreground"
              type="number"
              value={b.balance}
              onChange={(e) => setBalances((rows) => rows.map((r) => (r.key === b.key ? { ...r, balance: Number(e.target.value) || 0 } : r)))}
            />
            <button type="button" onClick={() => setBalances((rows) => rows.filter((r) => r.key !== b.key))} className="text-tiny text-neutral-500 hover:text-danger">
              {tr('remove')}
            </button>
          </div>
        ))}
      </Section>

      {/* Cashflows */}
      <Section
        title={tr('cashflows')}
        actionLabel={tr('addFlow')}
        onAdd={() =>
          setFlows((rows) => [
            ...rows,
            { key: crypto.randomUUID(), id: `flow-${rows.length + 1}`, direction: 'out', dueISO: plusDaysISO(14), amount: 0, currency: baseCurrency, category: 'other' },
          ])
        }
      >
        {flows.map((f) => (
          <div key={f.key} className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              value={f.direction}
              onChange={(e) => setFlows((rows) => rows.map((r) => (r.key === f.key ? { ...r, direction: e.target.value as 'in' | 'out' } : r)))}
            >
              <option value="in">in</option>
              <option value="out">out</option>
            </select>
            <input
              className="w-36 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              type="date"
              value={f.dueISO}
              onChange={(e) => setFlows((rows) => rows.map((r) => (r.key === f.key ? { ...r, dueISO: e.target.value } : r)))}
            />
            <CurrencySelect
              value={f.currency}
              onChange={(c) => setFlows((rows) => rows.map((r) => (r.key === f.key ? { ...r, currency: c } : r)))}
            />
            <input
              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-right text-xs text-foreground"
              type="number"
              value={f.amount}
              onChange={(e) => setFlows((rows) => rows.map((r) => (r.key === f.key ? { ...r, amount: Number(e.target.value) || 0 } : r)))}
            />
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              value={f.category}
              onChange={(e) => setFlows((rows) => rows.map((r) => (r.key === f.key ? { ...r, category: e.target.value as CashflowCategory } : r)))}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setFlows((rows) => rows.filter((r) => r.key !== f.key))} className="text-tiny text-neutral-500 hover:text-danger">
              {tr('remove')}
            </button>
          </div>
        ))}
      </Section>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onCompute}
          disabled={analyzeMut.isPending}
        >
          {analyzeMut.isPending ? tr('computing') : tr('compute')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRecommend}
          disabled={!analysis || recommendMut.isPending}
        >
          {recommendMut.isPending ? tr('recommending') : tr('recommend')}
        </Button>
        {analyzeMut.data?.persisted ? (
          <span className="self-center text-tiny text-success">{tr('persisted')}</span>
        ) : null}
      </div>

      {analyzeMut.isError ? (
        <p className="mt-3 rounded-md border border-danger/40 bg-danger-subtle/20 px-3 py-2 text-xs text-danger">
          {tr('error')}
        </p>
      ) : null}

      {analysis ? (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Metric
              label={tr('startingBalance')}
              value={fmt(analysis.runway.points[0]?.balanceBase ?? analysis.runway.minBalanceBase)}
            />
            <Metric label={tr('minBalance')} value={fmt(analysis.runway.minBalanceBase)} tone={analysis.runway.minBalanceBase < 0 ? 'danger' : 'default'} />
            <Metric
              label={tr('zeroCrossing')}
              value={analysis.runway.zeroCrossingISO ?? tr('neverInHorizon')}
              tone={analysis.runway.zeroCrossingISO ? 'danger' : 'success'}
            />
          </div>

          <div>
            <div className="mb-1 text-tiny uppercase tracking-wide text-neutral-500">{tr('exposure')}</div>
            <div className="flex flex-wrap gap-2">
              {analysis.exposure.rows.map((row) => (
                <div key={row.currency} className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="text-tiny uppercase tracking-wide text-neutral-500">{row.currency}</div>
                  <div className={`mt-0.5 font-mono text-sm ${row.netPositionBase < 0 ? 'text-danger' : 'text-foreground'}`}>
                    {fmt(row.netPositionBase)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {recommendations ? (
        <div className="mt-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr('recommendations')}</h4>
          {recommendations.length === 0 ? (
            <p className="text-xs text-neutral-400">{tr('noRecs')}</p>
          ) : (
            <ul className="space-y-2">
              {recommendations.map((rec) => (
                <li key={rec.id} className={`rounded-md border px-3 py-2 ${SEVERITY_TONE[rec.severity]}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{rec.title}</span>
                    <span className="text-tiny uppercase tracking-wide opacity-70">{rec.kind}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed opacity-90">{rec.rationale}</p>
                  <div className="mt-1.5 text-tiny uppercase tracking-wide opacity-70">
                    {tr('evidence')}: {rec.evidence.map((e) => e.pointer).join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}

// ─── Small presentational helpers ─────────────────────────────────────

function CurrencySelect({
  value,
  onChange,
}: {
  readonly value: CurrencyCode;
  readonly onChange: (next: CurrencyCode) => void;
}) {
  return (
    <select
      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      value={value}
      onChange={(e) => onChange(e.target.value as CurrencyCode)}
    >
      {CURRENCY_CODES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function Section({
  title,
  actionLabel,
  onAdd,
  children,
}: {
  readonly title: string;
  readonly actionLabel: string;
  readonly onAdd: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</span>
        <button type="button" onClick={onAdd} className="text-xs font-semibold text-signal-400 hover:text-signal-300">
          {actionLabel}
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'default' | 'danger' | 'success';
}) {
  const toneClass =
    tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-tiny uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${toneClass}`}>{value}</div>
    </div>
  );
}
