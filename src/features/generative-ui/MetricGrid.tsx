"use client";

/**
 * KPI metric grid for `metric.grid` specs. Renders each metric as a card
 * with optional sparkline (Recharts mini line) and delta trend indicator.
 */

import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { MetricGridSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";

interface Props {
  spec: MetricGridSpec;
}

export default function MetricGrid({ spec }: Props) {
  const cols = spec.columns ?? Math.min(spec.metrics.length, 4);
  const ariaLabel = spec.ariaLabel ?? spec.title ?? "Key metrics";

  return (
    <section
      aria-label={ariaLabel}
      className="my-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      {spec.title ? (
        <h3 className="mb-2 text-sm font-medium text-slate-800">
          {spec.title}
        </h3>
      ) : null}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {spec.metrics.map((metric, idx) => (
          <MetricCard key={`metric-${idx}`} metric={metric} />
        ))}
      </div>
      <SourceTrail {...(spec.source ?? {})} />
    </section>
  );
}

function MetricCard({ metric }: { metric: MetricGridSpec["metrics"][number] }) {
  const deltaSign =
    metric.delta === undefined
      ? null
      : metric.delta > 0
        ? "up"
        : metric.delta < 0
          ? "down"
          : "flat";
  const trend = metric.trend ?? deltaSign ?? null;
  const trendColor =
    trend === "up"
      ? "text-emerald-700"
      : trend === "down"
        ? "text-red-700"
        : "text-slate-500";
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {metric.label}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900">
        {metric.value}
        {metric.unit ? (
          <span className="ml-1 text-xs font-normal text-slate-500">
            {metric.unit}
          </span>
        ) : null}
      </div>
      {metric.delta !== undefined ? (
        <div className={`text-xs ${trendColor}`}>
          {trend === "up" ? "▲" : trend === "down" ? "▼" : "—"}{" "}
          {Math.abs(metric.delta).toFixed(2)}
          {metric.deltaLabel ? ` ${metric.deltaLabel}` : ""}
        </div>
      ) : null}
      {metric.sparkline && metric.sparkline.length > 1 ? (
        <div style={{ width: "100%", height: 32 }} aria-hidden>
          <ResponsiveContainer>
            <LineChart data={metric.sparkline.map((v, idx) => ({ idx, v }))}>
              <Line
                type="monotone"
                dataKey="v"
                stroke="#2563eb"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}
