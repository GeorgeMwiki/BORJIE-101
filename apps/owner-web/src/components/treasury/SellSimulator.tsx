'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { simulateSellVsHold } from '@/lib/types/treasury';
import { formatMoneyMillions, LAUNCH_CURRENCY } from '@/lib/format';
import { useFxSeeds } from '@/lib/queries/fx';
import type { Locale } from '@/lib/locale-shared';
import { treasuryPageStrings as S } from '@/i18n/strings/treasury-page';

interface SellSimulatorProps {
  readonly locale: Locale;
  readonly initialGoldUsdOz: number;
  readonly initialTzsUsd: number;
  readonly initialGrammes: number;
}

export function SellSimulator({
  locale,
  initialGoldUsdOz,
  initialTzsUsd,
  initialGrammes,
}: SellSimulatorProps) {
  const [goldUsd, setGoldUsd] = useState(initialGoldUsdOz);
  const [tzsUsd, setTzsUsd] = useState(initialTzsUsd);
  const [grammes, setGrammes] = useState(initialGrammes);
  const [holdDays, setHoldDays] = useState(14);

  // Seed gold + FX from the LIVE rate feed once it loads, but never stomp a
  // value the owner has already dragged. The `initial*` props remain the
  // fallback so the simulator is usable before the feed responds.
  const goldTouched = useRef(false);
  const fxTouched = useRef(false);
  const seeds = useFxSeeds();
  useEffect(() => {
    if (!goldTouched.current && seeds.goldUsdOz !== null) {
      setGoldUsd(seeds.goldUsdOz);
    }
    if (!fxTouched.current && seeds.tzsUsd !== null) {
      setTzsUsd(seeds.tzsUsd);
    }
  }, [seeds.goldUsdOz, seeds.tzsUsd]);

  const out = useMemo(
    () =>
      simulateSellVsHold({
        grammesAvailable: grammes,
        goldPriceAssumptionUsdOz: goldUsd,
        tzsUsd,
        treasuryHaircutPct: 5.5,
        daysToHold: holdDays,
        priceVolatilityPct: 6,
      }),
    [grammes, goldUsd, tzsUsd, holdDays],
  );

  const tone =
    out.recommendation === 'sell-now'
      ? 'border-warning/40 bg-warning-subtle/20 text-warning'
      : out.recommendation === 'hold'
        ? 'border-success/40 bg-success-subtle/20 text-success'
        : 'border-border bg-surface text-foreground';

  const recoLabel =
    out.recommendation === 'sell-now'
      ? S.sim.recoSellNow[locale]
      : out.recommendation === 'hold'
        ? S.sim.recoHold[locale]
        : S.sim.recoNeutral[locale];

  const money = (millions: number) =>
    formatMoneyMillions(millions, LAUNCH_CURRENCY);

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {S.sim.title[locale]}
      </div>
      <div className="mt-3 space-y-3">
        <Slider
          label={S.sim.goldAssumption(goldUsd)[locale]}
          min={1800}
          max={3000}
          step={10}
          value={goldUsd}
          onChange={(next) => {
            goldTouched.current = true;
            setGoldUsd(next);
          }}
        />
        <Slider
          label={S.sim.tzsUsd(tzsUsd)[locale]}
          min={2200}
          max={2900}
          step={5}
          value={tzsUsd}
          onChange={(next) => {
            fxTouched.current = true;
            setTzsUsd(next);
          }}
        />
        <Slider
          label={S.sim.grammes(grammes)[locale]}
          min={500}
          max={50_000}
          step={500}
          value={grammes}
          onChange={setGrammes}
        />
        <Slider
          label={S.sim.holdWindow(holdDays)[locale]}
          min={1}
          max={60}
          step={1}
          value={holdDays}
          onChange={setHoldDays}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Outcome label={S.sim.netNow[locale]} value={money(out.netNowTzsM)} />
        <Outcome
          label={S.sim.netHoldExpected(holdDays)[locale]}
          value={money(out.netHoldExpectedTzsM)}
        />
        <Outcome label={S.sim.lowBand[locale]} value={money(out.netHoldLowTzsM)} />
        <Outcome label={S.sim.highBand[locale]} value={money(out.netHoldHighTzsM)} />
      </div>
      <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${tone}`}>
        {S.sim.recommendation[locale]}: <strong>{recoLabel}</strong>
      </div>
    </article>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (next: number) => void;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      <span className="mb-1 block">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-warning"
      />
    </label>
  );
}

function Outcome({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-tiny uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-foreground">{value}</div>
    </div>
  );
}
