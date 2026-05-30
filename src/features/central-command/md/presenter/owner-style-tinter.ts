/**
 * Owner-Style Tinter — adapts a built spec to the owner's preferred
 * density.
 *
 *   - "terse":    drop secondary columns, hide titles where possible,
 *                 collapse pagination, prefer compact table over chart.
 *   - "balanced": leave the spec untouched.
 *   - "verbose":  pair the table/chart with a brief narrative markdown
 *                 (returned as a sibling spec? — no, we return a
 *                 SINGLE spec to keep the SSE contract simple, so
 *                 verbose mode rewraps tables as
 *                 markdown-plus-table summary).
 *
 * NOTE: every transformation is pure — we never mutate the input
 * spec; we build a new one and re-validate via the per-kind Zod
 * schema so the tinted output is still safe to render.
 *
 * @module features/central-command/md/presenter/owner-style-tinter
 */

import {
  buildTable,
  buildTimeSeriesChart,
} from "@/core/brain/generative-ui/builders";
import {
  parseGenerativeUiSpec,
  type GenerativeUiSpec,
  type TableSpec,
  type RechartsTimeSeriesSpec,
} from "@/core/brain/generative-ui/types";

import type { OwnerStyleHint } from "./types";

// ---------------------------------------------------------------------------
// Terse helpers
// ---------------------------------------------------------------------------

/**
 * Keep at most the first N columns. We preserve the first column
 * (typically the entity name) plus the next N-1; rows are also
 * projected to the kept keys so the renderer doesn't see orphaned
 * cells.
 */
function terseTable(spec: TableSpec, maxCols = 3): TableSpec {
  if (spec.columns.length <= maxCols) {
    return parseGenerativeUiSpec({
      ...spec,
      filterable: false,
      pagination: spec.pagination
        ? { pageSize: Math.min(20, spec.pagination.pageSize) }
        : undefined,
    }) as TableSpec;
  }
  const keptColumns = spec.columns.slice(0, maxCols);
  const keptKeys = new Set(keptColumns.map((c) => c.key));
  const keptRows = spec.rows.map((r) => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const k of keptKeys) {
      out[k] =
        (r as Record<string, string | number | boolean | null>)[k] ?? null;
    }
    return out;
  });
  return buildTable({
    title: spec.title,
    columns: keptColumns,
    rows: keptRows,
    sortable: false,
    filterable: false,
    pagination: undefined,
    ariaLabel: spec.ariaLabel,
    source: spec.source,
  });
}

function terseChart(spec: RechartsTimeSeriesSpec): RechartsTimeSeriesSpec {
  // Drop secondary series — keep the headline (first) series only.
  if (spec.series.length <= 1) return spec;
  const [first] = spec.series;
  if (!first) return spec;
  return buildTimeSeriesChart({
    series: [first],
    title: spec.title,
    ariaLabel: spec.ariaLabel,
    xLabel: spec.xLabel,
    yLabel: spec.yLabel,
    refLines: spec.refLines,
    stacked: false,
    area: false,
    source: spec.source,
  });
}

// ---------------------------------------------------------------------------
// Verbose helpers
// ---------------------------------------------------------------------------

function summariseTable(spec: TableSpec): string {
  const total = spec.rows.length;
  const cols = spec.columns.map((c) => c.label).join(", ");
  return `Showing ${total} ${total === 1 ? "row" : "rows"}. Columns: ${cols}.`;
}

function summariseChart(spec: RechartsTimeSeriesSpec): string {
  const series = spec.series.length;
  const points = spec.series.reduce((sum, s) => sum + s.data.length, 0);
  return `Plotting ${series} series across ${points} points.`;
}

function verboseTable(spec: TableSpec): TableSpec {
  // Keep the table identical but extend title with a narrative
  // suffix so the chat surface gives the owner the gist before they
  // scroll.
  const suffix = summariseTable(spec);
  return parseGenerativeUiSpec({
    ...spec,
    title: spec.title ? `${spec.title} — ${suffix}` : suffix,
  }) as TableSpec;
}

function verboseChart(spec: RechartsTimeSeriesSpec): RechartsTimeSeriesSpec {
  const suffix = summariseChart(spec);
  return parseGenerativeUiSpec({
    ...spec,
    title: spec.title ? `${spec.title} — ${suffix}` : suffix,
  }) as RechartsTimeSeriesSpec;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export interface TintInput {
  readonly spec: GenerativeUiSpec;
  readonly hint?: OwnerStyleHint;
}

/**
 * Apply an owner-style transformation to a built spec. Returns a NEW
 * spec; the input is never mutated. The output passes the same Zod
 * validation as the input (via per-kind builders).
 */
export function tintForOwnerStyle(input: TintInput): GenerativeUiSpec {
  const hint = input.hint ?? "balanced";
  if (hint === "balanced") return input.spec;

  switch (input.spec.kind) {
    case "table":
      return hint === "terse"
        ? terseTable(input.spec)
        : verboseTable(input.spec);
    case "chart.recharts.timeseries":
      return hint === "terse"
        ? terseChart(input.spec)
        : verboseChart(input.spec);
    case "metric.grid":
      if (hint === "terse") {
        // Keep at most 3 metrics; drop sparklines.
        const slim = {
          ...input.spec,
          metrics: input.spec.metrics
            .slice(0, 3)
            .map((m) => ({ ...m, sparkline: undefined })),
          columns: Math.min(3, input.spec.metrics.length || 1),
        };
        return parseGenerativeUiSpec(slim);
      }
      return input.spec;
    case "markdown":
    case "mermaid":
    case "chart.vega-lite":
    case "form":
    case "confirm":
    case "map":
    default:
      // No transformation defined; return the input untouched.
      return input.spec;
  }
}
