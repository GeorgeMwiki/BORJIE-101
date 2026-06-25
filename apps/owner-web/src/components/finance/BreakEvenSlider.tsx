'use client';

import { useEffect, useRef, useState } from 'react';
import { computeBreakEven } from '@/lib/types/finance';
import { formatMoney, LAUNCH_CURRENCY, bcp47For } from '@/lib/format';
import { useFxSeeds } from '@/lib/queries/fx';
import { useLocale, type Locale } from '@/lib/locale';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';

interface BreakEvenSliderProps {
  readonly initialGoldUsdOz: number;
  readonly initialTzsUsd: number;
  readonly initialUnitCostTzsPerG: number;
  readonly initialLocale?: Locale;
}

export function BreakEvenSlider({
  initialGoldUsdOz,
  initialTzsUsd,
  initialUnitCostTzsPerG,
  initialLocale,
}: BreakEvenSliderProps) {
  const locale = useLocale(initialLocale);
  const [goldUsd, setGoldUsd] = useState(initialGoldUsdOz);
  const [tzsUsd, setTzsUsd] = useState(initialTzsUsd);
  const [unitCost, setUnitCost] = useState(initialUnitCostTzsPerG);

  // Seed gold + FX from the LIVE rate feed once it loads, but never stomp a
  // value the owner has already dragged. The `initial*` props remain the
  // fallback so the slider is usable before the feed responds.
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

  const out = computeBreakEven(goldUsd, tzsUsd, unitCost);
  const positive = out.netMarginTzsPerG > 0;

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {S.breakEven.title(LAUNCH_CURRENCY)[locale]}
      </div>
      <div className="mt-3 space-y-4">
        <SliderRow
          label={S.breakEven.goldPrice(goldUsd)[locale]}
          min={1800}
          max={3000}
          step={10}
          value={goldUsd}
          onChange={(next) => {
            goldTouched.current = true;
            setGoldUsd(next);
          }}
        />
        <SliderRow
          label={S.breakEven.tzsUsd(tzsUsd)[locale]}
          min={2200}
          max={2900}
          step={5}
          value={tzsUsd}
          onChange={(next) => {
            fxTouched.current = true;
            setTzsUsd(next);
          }}
        />
        <SliderRow
          label={
            S.breakEven.unitCost(
              unitCost.toLocaleString(bcp47For(locale)),
              LAUNCH_CURRENCY,
            )[locale]
          }
          min={60000}
          max={180000}
          step={1000}
          value={unitCost}
          onChange={setUnitCost}
        />
      </div>
      <div
        className={`mt-4 rounded-md border px-3 py-2 text-sm ${
          positive
            ? 'border-success/40 bg-success-subtle/20 text-success'
            : 'border-destructive/40 bg-destructive/10 text-destructive'
        }`}
      >
        {
          S.breakEven.netMargin(
            formatMoney(out.netMarginTzsPerG, LAUNCH_CURRENCY, locale),
          )[locale]
        }
      </div>
    </article>
  );
}

function SliderRow({
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
      <span className="block mb-1">{label}</span>
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
