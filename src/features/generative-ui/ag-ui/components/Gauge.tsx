"use client";

/**
 * 19. gauge — SVG radial progress dial.
 *
 * Used for NPS, collection-rate, occupancy. Thresholds drive the
 * arc colour bands; the needle's colour matches the active threshold.
 */

import { useMemo } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { GaugePartSchema } from "../schemas";
import { formatNumber, formatPercent } from "../format";

export type GaugeProps = AgUiUiPartByKind<"gauge">;

const SIZE = 160;
const CX = SIZE / 2;
const CY = SIZE / 2 + 10;
const R = 60;
const STROKE = 14;

function polar(angle: number, radius: number): { x: number; y: number } {
  const rad = (angle - 90) * (Math.PI / 180);
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

function arcPath(startAngle: number, endAngle: number): string {
  const start = polar(endAngle, R);
  const end = polar(startAngle, R);
  const large = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${R} ${R} 0 ${large} 0 ${end.x} ${end.y}`;
}

function formatGaugeValue(props: GaugeProps, v: number): string {
  if (props.format === "percent") return formatPercent(v);
  if (props.format === "currency" && props.currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: props.currency,
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return `${props.currency} ${formatNumber(v)}`;
    }
  }
  return formatNumber(v);
}

export function Gauge(props: GaugeProps): JSX.Element {
  const parsed = GaugePartSchema.safeParse(props);

  const { angle, activeColor } = useMemo(() => {
    const clamped = Math.max(props.min, Math.min(props.max, props.value));
    const t = (clamped - props.min) / (props.max - props.min);
    const ang = -90 + t * 180; // 180° sweep, top=0..180 from -90..+90
    let color = "#3b82f6";
    if (props.thresholds && props.thresholds.length > 0) {
      const sorted = [...props.thresholds].sort((a, b) => a.value - b.value);
      for (const th of sorted) {
        if (clamped >= th.value) color = th.color;
      }
    }
    return { angle: ang, activeColor: color };
  }, [props.max, props.min, props.thresholds, props.value]);

  if (!parsed.success) {
    return (
      <GenUiError
        kind="gauge"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  return (
    <Frame kind="gauge" {...(props.title ? { title: props.title } : {})}>
      <div className="flex flex-col items-center">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={props.label}
        >
          <path
            d={arcPath(-90, 90)}
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={arcPath(-90, angle)}
            stroke={activeColor}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
          {/* needle */}
          <line
            x1={CX}
            y1={CY}
            x2={polar(angle, R - 4).x}
            y2={polar(angle, R - 4).y}
            stroke="currentColor"
            strokeWidth={2}
          />
          <circle cx={CX} cy={CY} r={4} fill="currentColor" />
        </svg>
        <div className="-mt-1 text-center">
          <div className="text-lg font-semibold text-foreground">
            {formatGaugeValue(props, props.value)}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {props.label}
          </div>
        </div>
      </div>
    </Frame>
  );
}
