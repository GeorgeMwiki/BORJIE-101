'use client';

import { useState } from 'react';
import { computeBreakEven } from '@/lib/mocks/finance';
import { fmtTzs } from '@/lib/format';

interface BreakEvenSliderProps {
  readonly initialGoldUsdOz: number;
  readonly initialTzsUsd: number;
  readonly initialUnitCostTzsPerG: number;
}

export function BreakEvenSlider({
  initialGoldUsdOz,
  initialTzsUsd,
  initialUnitCostTzsPerG,
}: BreakEvenSliderProps) {
  const [goldUsd, setGoldUsd] = useState(initialGoldUsdOz);
  const [tzsUsd, setTzsUsd] = useState(initialTzsUsd);
  const [unitCost, setUnitCost] = useState(initialUnitCostTzsPerG);
  const out = computeBreakEven(goldUsd, tzsUsd, unitCost);
  const positive = out.netMarginTzsPerG > 0;

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Break-even sensitivity · TZS / g
      </div>
      <div className="mt-3 space-y-4">
        <SliderRow
          label={`Gold price USD/oz · ${goldUsd}`}
          min={1800}
          max={3000}
          step={10}
          value={goldUsd}
          onChange={setGoldUsd}
        />
        <SliderRow
          label={`TZS/USD · ${tzsUsd}`}
          min={2200}
          max={2900}
          step={5}
          value={tzsUsd}
          onChange={setTzsUsd}
        />
        <SliderRow
          label={`Unit all-in cost TZS/g · ${unitCost.toLocaleString()}`}
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
        Net margin: {fmtTzs(out.netMarginTzsPerG)} / g
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
    <label className="block text-xs text-neutral-300">
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
