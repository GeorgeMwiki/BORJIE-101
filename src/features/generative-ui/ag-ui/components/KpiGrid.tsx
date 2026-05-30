"use client";

/**
 * 4. kpi-grid — KPI tile cluster (Tremor + shadcn Card style).
 *
 * Renders a responsive grid of value tiles with optional delta arrows
 * for at-a-glance dashboards. Tremor would handle this if installed;
 * we ship a no-dep version that matches the look.
 */

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { KpiGridPartSchema } from "../schemas";
import { formatCurrency, formatNumber, formatPercent } from "../format";

export type KpiGridProps = AgUiUiPartByKind<"kpi-grid">;

function formatTileValue(t: KpiGridProps["tiles"][number]): string {
  if (typeof t.value === "string") return t.value;
  if (t.format === "currency" && t.currency)
    return formatCurrency(t.value, t.currency);
  if (t.format === "percent") return formatPercent(t.value);
  return formatNumber(t.value);
}

const ARROW: Record<
  NonNullable<KpiGridProps["tiles"][number]["deltaDirection"]>,
  string
> = {
  up: "▲",
  down: "▼",
  flat: "→",
};

const DELTA_COLOUR: Record<string, string> = {
  up: "text-green-600",
  down: "text-red-600",
  flat: "text-muted-foreground",
};

export function KpiGrid(props: KpiGridProps): JSX.Element {
  const parsed = KpiGridPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="kpi-grid"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame kind="kpi-grid" {...(props.title ? { title: props.title } : {})}>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {props.tiles.map((t, i) => (
          <div
            key={i}
            className="rounded border border-border bg-surface-sunken px-3 py-2"
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t.label}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {formatTileValue(t)}
            </div>
            {t.delta !== undefined && t.deltaDirection ? (
              <div
                className={`text-[11px] ${DELTA_COLOUR[t.deltaDirection] ?? ""}`}
              >
                {ARROW[t.deltaDirection]} {Math.abs(t.delta).toFixed(2)}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Frame>
  );
}
