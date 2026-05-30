"use client";

/**
 * Recharts time-series renderer for `chart.recharts.timeseries` specs.
 *
 * Supports:
 *   - Multi-series line/area charts
 *   - Reference lines (target / threshold)
 *   - Stacked area mode
 *   - Aria label derived from the spec (deterministic — never from the model)
 */

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { RechartsTimeSeriesSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";

interface Props {
  spec: RechartsTimeSeriesSpec;
}

const DEFAULT_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#65a30d",
  "#db2777",
  "#0284c7",
  "#7c2d12",
  "#475569",
  "#854d0e",
];

export default function ChartRechartsTimeSeries({ spec }: Props) {
  const palette = spec.colors ?? DEFAULT_COLORS;
  const useArea = spec.area === true;

  // Flatten into a single dataset indexed by x-axis value.
  const xValues = new Set<string | number>();
  spec.series.forEach((s) => s.data.forEach((p) => xValues.add(p.t)));
  const orderedX = Array.from(xValues).sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  });
  const dataset = orderedX.map((x) => {
    const row: Record<string, string | number> = { t: x };
    spec.series.forEach((s) => {
      const point = s.data.find((p) => p.t === x);
      if (point) row[s.name] = point.y;
    });
    return row;
  });

  const ariaLabel =
    spec.ariaLabel ??
    `Time series chart with ${spec.series.length} series and ${dataset.length} points`;

  return (
    <figure
      role="figure"
      aria-label={ariaLabel}
      className="my-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      {spec.title ? (
        <figcaption className="mb-2 text-sm font-medium text-slate-800">
          {spec.title}
        </figcaption>
      ) : null}
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          {useArea ? (
            <AreaChart data={dataset}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="t" label={renderAxisLabel(spec.xLabel, "x")} />
              <YAxis label={renderAxisLabel(spec.yLabel, "y")} />
              <Tooltip />
              <Legend />
              {(spec.refLines ?? []).map((rl, idx) => (
                <ReferenceLine
                  key={`rl-${idx}`}
                  y={rl.y}
                  stroke={rl.color ?? "#94a3b8"}
                  label={rl.label}
                  strokeDasharray="4 4"
                />
              ))}
              {spec.series.map((s, idx) => (
                <Area
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stackId={spec.stacked ? "stacked" : undefined}
                  fill={s.color ?? palette[idx % palette.length]}
                  stroke={s.color ?? palette[idx % palette.length]}
                  fillOpacity={0.35}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={dataset}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="t" label={renderAxisLabel(spec.xLabel, "x")} />
              <YAxis label={renderAxisLabel(spec.yLabel, "y")} />
              <Tooltip />
              <Legend />
              {(spec.refLines ?? []).map((rl, idx) => (
                <ReferenceLine
                  key={`rl-${idx}`}
                  y={rl.y}
                  stroke={rl.color ?? "#94a3b8"}
                  label={rl.label}
                  strokeDasharray="4 4"
                />
              ))}
              {spec.series.map((s, idx) => (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stroke={s.color ?? palette[idx % palette.length]}
                  dot={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <DataTableFallback spec={spec} />
      <SourceTrail {...(spec.source ?? {})} />
    </figure>
  );
}

function renderAxisLabel(label: string | undefined, axis: "x" | "y") {
  if (!label) return undefined;
  return {
    value: label,
    position: axis === "x" ? "insideBottom" : "insideLeft",
    offset: axis === "x" ? -4 : 0,
    angle: axis === "y" ? -90 : 0,
    style: { fill: "#64748b", fontSize: 12 },
  } as const;
}

/**
 * Hidden but screen-reader-discoverable data table. Critical for WCAG AA
 * compliance — charts must offer a textual equivalent. We render it
 * visually hidden but keyboard-reachable.
 */
function DataTableFallback({ spec }: { spec: RechartsTimeSeriesSpec }) {
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer">Data table</summary>
      <table className="mt-1 w-full border-collapse text-left">
        <thead>
          <tr>
            <th className="border-b border-slate-200 py-1 pr-3">
              {spec.xLabel ?? "x"}
            </th>
            {spec.series.map((s) => (
              <th key={s.name} className="border-b border-slate-200 py-1 pr-3">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.series[0]?.data.map((point, idx) => (
            <tr key={`row-${idx}`}>
              <td className="py-1 pr-3 font-mono">{String(point.t)}</td>
              {spec.series.map((s) => {
                const p = s.data.find((d) => d.t === point.t);
                return (
                  <td key={s.name} className="py-1 pr-3 font-mono">
                    {p ? p.y : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
