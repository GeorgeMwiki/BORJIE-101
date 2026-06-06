'use client';

/**
 * Cost-engineer advisor panel — owner finance surface.
 *
 * Drives the real `@borjie/cost-engineer-advisor` via the mining BFF:
 * the owner enters a production period (tonnes produced/sold, realised
 * price), opex buckets, royalty + treatment charges; the panel computes
 * a P&L + unit economics + price/fuel sensitivity (and persists the
 * snapshot), then derives evidence-backed cost recommendations.
 *
 * Every money value renders through `formatCurrency(amount, currency)`
 * with the analysis's OWN currency — never a hardcoded TZS/USD literal.
 * Each recommendation shows its non-empty evidence chain.
 */

import { useMemo, useState } from 'react';
import { formatCurrency } from '@borjie/api-client';
import {
  useCostAnalyze,
  useCostRecommend,
  type CostAnalysis,
  type CostRecommendation,
  type CurrencyCode,
  type SensitivityRow,
  CURRENCY_CODES,
} from '@/lib/queries/cost-engineer';

interface CostEngineerPanelProps {
  readonly locale: 'sw' | 'en';
  readonly siteId?: string;
}

const T = {
  title: { en: 'Cost engineer', sw: 'Mhandisi wa gharama' },
  subtitle: {
    en: 'Compute P&L, unit economics and price/fuel sensitivity, then get evidence-backed cost advice.',
    sw: 'Kokotoa faida/hasara, uchumi wa kila tani na athari za bei/mafuta, kisha pata ushauri wa gharama wenye ushahidi.',
  },
  period: { en: 'Period label', sw: 'Lebo ya kipindi' },
  tonnesProduced: { en: 'Tonnes produced', sw: 'Tani zilizozalishwa' },
  tonnesSold: { en: 'Tonnes sold', sw: 'Tani zilizouzwa' },
  realisedPrice: { en: 'Realised price / tonne', sw: 'Bei halisi / tani' },
  royaltyRate: { en: 'Royalty rate (0–1)', sw: 'Kiwango cha mrabaha (0–1)' },
  treatment: { en: 'Treatment charge / tonne', sw: 'Gharama ya uchakataji / tani' },
  capex: { en: 'Capex amortisation', sw: 'Ustahimilishaji wa capex' },
  currency: { en: 'Currency', sw: 'Sarafu' },
  opex: { en: 'Opex buckets', sw: 'Mafungu ya gharama za uendeshaji' },
  addOpex: { en: '+ Add bucket', sw: '+ Ongeza fungu' },
  remove: { en: 'Remove', sw: 'Ondoa' },
  compute: { en: 'Compute analysis', sw: 'Kokotoa uchambuzi' },
  computing: { en: 'Computing…', sw: 'Inakokotoa…' },
  recommend: { en: 'Get recommendations', sw: 'Pata mapendekezo' },
  recommending: { en: 'Deriving…', sw: 'Inatoa…' },
  revenue: { en: 'Revenue', sw: 'Mapato' },
  grossProfit: { en: 'Gross profit', sw: 'Faida ghafi' },
  ebitda: { en: 'EBITDA', sw: 'EBITDA' },
  ebit: { en: 'EBIT', sw: 'EBIT' },
  netMargin: { en: 'Net margin', sw: 'Ukingo halisi' },
  costPerTonne: { en: 'Cash cost / tonne', sw: 'Gharama ya fedha / tani' },
  aisc: { en: 'AISC / tonne', sw: 'AISC / tani' },
  breakEven: { en: 'Break-even price / tonne', sw: 'Bei ya kuvunja-sawa / tani' },
  marginPerTonne: { en: 'Margin / tonne', sw: 'Ukingo / tani' },
  priceSensitivity: { en: 'Price sensitivity (EBITDA)', sw: 'Athari ya bei (EBITDA)' },
  fuelSensitivity: { en: 'Fuel sensitivity (EBITDA)', sw: 'Athari ya mafuta (EBITDA)' },
  recommendations: { en: 'Recommendations', sw: 'Mapendekezo' },
  evidence: { en: 'Evidence', sw: 'Ushahidi' },
  noRecs: {
    en: 'No cost issues flagged against the current benchmarks.',
    sw: 'Hakuna masuala ya gharama yaliyoonyeshwa dhidi ya vigezo vya sasa.',
  },
  persisted: { en: 'Snapshot saved', sw: 'Picha imehifadhiwa' },
  error: { en: 'Could not compute. Check inputs and retry.', sw: 'Imeshindwa kukokotoa. Angalia taarifa na ujaribu tena.' },
} as const;

interface OpexRow {
  readonly id: string;
  readonly label: string;
  readonly amount: string;
}

function newOpexRow(label = '', amount = ''): OpexRow {
  return { id: crypto.randomUUID(), label, amount };
}

const SEVERITY_TONE: Record<CostRecommendation['severity'], string> = {
  info: 'border-border bg-surface text-foreground',
  low: 'border-border bg-surface text-foreground',
  medium: 'border-warning/40 bg-warning-subtle/20 text-warning',
  high: 'border-warning/40 bg-warning-subtle/20 text-warning',
  critical: 'border-danger/40 bg-danger-subtle/20 text-danger',
};

export function CostEngineerPanel({ locale, siteId }: CostEngineerPanelProps) {
  const tr = (k: keyof typeof T) => T[k][locale];

  const [periodLabel, setPeriodLabel] = useState('2026-05');
  const [tonnesProduced, setTonnesProduced] = useState('1000');
  const [tonnesSold, setTonnesSold] = useState('950');
  const [realisedPrice, setRealisedPrice] = useState('180000');
  const [royaltyRate, setRoyaltyRate] = useState('0.06');
  const [treatment, setTreatment] = useState('5000');
  const [capex, setCapex] = useState('20000');
  const [currency, setCurrency] = useState<CurrencyCode>('TZS');
  const [opex, setOpex] = useState<ReadonlyArray<OpexRow>>([
    newOpexRow('Diesel', '40000000'),
    newOpexRow('Wages', '30000000'),
  ]);

  const analyzeMut = useCostAnalyze();
  const recommendMut = useCostRecommend();

  const analysis: CostAnalysis | undefined = analyzeMut.data?.analysis;
  const recommendations = recommendMut.data?.recommendations;

  const fmt = useMemo(
    () => (value: number) =>
      formatCurrency(value, analysis?.currency ?? currency, {
        locale: locale === 'sw' ? 'sw-TZ' : 'en-US',
      }),
    [analysis?.currency, currency, locale],
  );

  function updateOpex(id: string, patch: Partial<OpexRow>) {
    setOpex((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function buildRequest() {
    return {
      period: {
        periodLabel,
        startISO: `${periodLabel}-01`,
        endISO: `${periodLabel}-28`,
        tonnesProduced: Number(tonnesProduced) || 0,
        tonnesSold: Number(tonnesSold) || 0,
        averageRealisedPricePerTonne: Number(realisedPrice) || 0,
      },
      currency,
      opexBuckets: opex
        .filter((r) => r.label.trim().length > 0)
        .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) || 0 })),
      capexAmortisationForPeriod: Number(capex) || 0,
      cogs: {
        royaltyRate: Number(royaltyRate) || 0,
        treatmentChargesPerTonne: Number(treatment) || 0,
      },
      ...(siteId ? { siteId } : {}),
    };
  }

  function onCompute() {
    recommendMut.reset();
    analyzeMut.mutate(buildRequest());
  }

  function onRecommend() {
    if (!analysis) return;
    recommendMut.mutate({ analysis });
  }

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{tr('title')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">{tr('subtitle')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={tr('period')} value={periodLabel} onChange={setPeriodLabel} />
        <Field label={tr('currency')} as="select" value={currency} onChange={(v) => setCurrency(v as CurrencyCode)} options={CURRENCY_CODES} />
        <Field label={tr('tonnesProduced')} value={tonnesProduced} onChange={setTonnesProduced} type="number" />
        <Field label={tr('tonnesSold')} value={tonnesSold} onChange={setTonnesSold} type="number" />
        <Field label={tr('realisedPrice')} value={realisedPrice} onChange={setRealisedPrice} type="number" />
        <Field label={tr('royaltyRate')} value={royaltyRate} onChange={setRoyaltyRate} type="number" />
        <Field label={tr('treatment')} value={treatment} onChange={setTreatment} type="number" />
        <Field label={tr('capex')} value={capex} onChange={setCapex} type="number" />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr('opex')}</span>
          <button
            type="button"
            onClick={() => setOpex((rows) => [...rows, newOpexRow()])}
            className="text-xs font-semibold text-signal-400 hover:text-signal-300"
          >
            {tr('addOpex')}
          </button>
        </div>
        <div className="space-y-2">
          {opex.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                placeholder="label"
                value={row.label}
                onChange={(e) => updateOpex(row.id, { label: e.target.value })}
              />
              <input
                className="w-40 rounded-md border border-border bg-background px-2 py-1 text-right text-xs text-foreground"
                placeholder="amount"
                type="number"
                value={row.amount}
                onChange={(e) => updateOpex(row.id, { amount: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setOpex((rows) => rows.filter((r) => r.id !== row.id))}
                className="text-tiny text-neutral-500 hover:text-danger"
              >
                {tr('remove')}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCompute}
          disabled={analyzeMut.isPending}
          className="rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400 disabled:opacity-50"
        >
          {analyzeMut.isPending ? tr('computing') : tr('compute')}
        </button>
        <button
          type="button"
          onClick={onRecommend}
          disabled={!analysis || recommendMut.isPending}
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-background disabled:opacity-50"
        >
          {recommendMut.isPending ? tr('recommending') : tr('recommend')}
        </button>
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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Metric label={tr('revenue')} value={fmt(analysis.pnl.revenue)} />
            <Metric label={tr('grossProfit')} value={fmt(analysis.pnl.grossProfit)} />
            <Metric label={tr('ebitda')} value={fmt(analysis.pnl.ebitda)} />
            <Metric label={tr('ebit')} value={fmt(analysis.pnl.ebit)} />
            <Metric label={tr('netMargin')} value={`${(analysis.pnl.netMarginPercent * 100).toFixed(1)}%`} />
            <Metric label={tr('costPerTonne')} value={fmt(analysis.unit.cashCostPerTonne)} />
            <Metric label={tr('aisc')} value={fmt(analysis.unit.allInSustainingCostPerTonne)} />
            <Metric label={tr('breakEven')} value={fmt(analysis.unit.breakEvenPricePerTonne)} />
            <Metric label={tr('marginPerTonne')} value={fmt(analysis.unit.marginPerTonne)} />
          </div>

          <SensitivityTable title={tr('priceSensitivity')} rows={analysis.sensitivity.priceSensitivity} fmt={fmt} />
          <SensitivityTable title={tr('fuelSensitivity')} rows={analysis.sensitivity.fuelSensitivity} fmt={fmt} />
        </div>
      ) : null}

      {recommendations ? (
        <div className="mt-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {tr('recommendations')}
          </h4>
          {recommendations.length === 0 ? (
            <p className="text-xs text-neutral-400">{tr('noRecs')}</p>
          ) : (
            <ul className="space-y-2">
              {recommendations.map((rec) => (
                <li key={rec.id} className={`rounded-md border px-3 py-2 ${SEVERITY_TONE[rec.severity]}`}>
                  <div className="text-xs font-semibold">{rec.title}</div>
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

function Field({
  label,
  value,
  onChange,
  type = 'text',
  as = 'input',
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly type?: string;
  readonly as?: 'input' | 'select';
  readonly options?: ReadonlyArray<string>;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-neutral-400">{label}</span>
      {as === 'select' ? (
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-foreground"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {(options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-foreground"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-tiny uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function SensitivityTable({
  title,
  rows,
  fmt,
}: {
  readonly title: string;
  readonly rows: ReadonlyArray<SensitivityRow>;
  readonly fmt: (value: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 text-tiny uppercase tracking-wide text-neutral-500">{title}</div>
      <div className="flex gap-1 overflow-x-auto">
        {rows.map((r) => (
          <div
            key={r.deltaPercent}
            className="min-w-[64px] rounded-md border border-border bg-background px-2 py-1 text-center"
          >
            <div className={`text-tiny ${r.deltaPercent < 0 ? 'text-danger' : r.deltaPercent > 0 ? 'text-success' : 'text-neutral-400'}`}>
              {r.deltaPercent > 0 ? '+' : ''}
              {r.deltaPercent}%
            </div>
            <div className="mt-0.5 font-mono text-tiny text-foreground">{fmt(r.ebitda)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
