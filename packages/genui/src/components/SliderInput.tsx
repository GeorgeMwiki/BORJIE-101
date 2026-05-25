'use client';

/**
 * 24. slider-input — range input for rent-negotiation, budget-allocation,
 * pricing what-if. The brain emits the bounds + initial value; the
 * component dispatches `genui:slider-change` (or the configured kind)
 * via CustomEvent so the host portal can wire it to a tool/message.
 */

import { useState } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { SliderInputPartSchema } from '../schemas';
import { formatNumber, formatPercent } from '../format';

export type SliderInputProps = AgUiUiPartByKind<'slider-input'>;

function fmt(props: SliderInputProps, v: number): string {
  if (props.format === 'percent') return formatPercent(v);
  if (props.format === 'currency' && props.currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: props.currency,
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return `${props.currency} ${formatNumber(v)}`;
    }
  }
  return formatNumber(v);
}

function dispatchChange(
  action: { kind: 'tool' | 'message'; payload: Readonly<Record<string, unknown>> },
  value: number,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('genui:slider-change', {
        detail: { value, ...action },
      }),
    );
  } catch {
    /* ignore */
  }
}

export function SliderInput(props: SliderInputProps): JSX.Element {
  const parsed = SliderInputPartSchema.safeParse(props);
  const [current, setCurrent] = useState<number>(props.value);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="slider-input"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }

  return (
    <Frame kind="slider-input" {...(props.title ? { title: props.title } : {})}>
      <label className="flex flex-col gap-2 text-sm">
        <span className="flex items-center justify-between">
          <span className="text-foreground">{props.label}</span>
          <span className="rounded bg-surface-sunken px-2 py-0.5 text-xs font-medium tabular-nums">
            {fmt(props, current)}
          </span>
        </span>
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={current}
          onChange={(e) => {
            const next = Number(e.currentTarget.value);
            setCurrent(next);
          }}
          onMouseUp={() => dispatchChange(props.onChangeAction, current)}
          onTouchEnd={() => dispatchChange(props.onChangeAction, current)}
          onKeyUp={() => dispatchChange(props.onChangeAction, current)}
          className="w-full"
          aria-label={props.label}
        />
        <span className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{fmt(props, props.min)}</span>
          <span>{fmt(props, props.max)}</span>
        </span>
      </label>
    </Frame>
  );
}
