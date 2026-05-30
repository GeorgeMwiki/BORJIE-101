"use client";

/**
 * 30. comparison-table — typed equivalent of block-system's
 * `property_comparison_table`. One row per attribute, one column per
 * subject (property, unit, tenant…). Optional best/worst highlight.
 */

import type { AgUiUiPartByKind, ComparisonRow } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ComparisonTablePartSchema } from "../schemas";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  type Currency,
} from "../format";

export type ComparisonTableProps = AgUiUiPartByKind<"comparison-table">;

function formatComparisonValue(
  row: ComparisonRow,
  v: string | number | null,
): string {
  if (v === null || v === undefined) return "—";
  if (row.format === "currency" && row.currency && typeof v === "number") {
    return formatCurrency(v, row.currency as Currency);
  }
  if (row.format === "percent" && typeof v === "number") {
    return formatPercent(v);
  }
  if (row.format === "number" && typeof v === "number") {
    return formatNumber(v);
  }
  if (row.format === "date" && typeof v === "string") {
    return formatDate(v);
  }
  return String(v);
}

function classifyHighlight(
  row: ComparisonRow,
  v: string | number | null,
  _colIdx: number,
): "best" | "worst" | "none" {
  if (row.highlight === "none" || !row.highlight) return "none";
  const numericValues = row.values
    .map((x) => (typeof x === "number" ? x : null))
    .filter((x): x is number => x !== null);
  if (numericValues.length < 2 || typeof v !== "number") return "none";
  const best =
    row.highlight === "best"
      ? Math.max(...numericValues)
      : Math.min(...numericValues);
  return v === best ? row.highlight : "none";
}

export function ComparisonTable(props: ComparisonTableProps): JSX.Element {
  const parsed = ComparisonTablePartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="comparison-table"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  return (
    <Frame
      kind="comparison-table"
      {...(props.title ? { title: props.title } : {})}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-border bg-surface-sunken px-2 py-1 text-left font-medium text-muted-foreground">
                Attribute
              </th>
              {props.columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-border bg-surface-sunken px-2 py-1 text-left font-medium text-foreground"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.key} className="even:bg-surface-sunken/50">
                <td className="border-b border-border/40 px-2 py-1 text-muted-foreground">
                  {r.label}
                </td>
                {r.values.map((v, i) => {
                  const cls = classifyHighlight(r, v, i);
                  return (
                    <td
                      key={i}
                      className={
                        cls === "best"
                          ? "border-b border-border/40 px-2 py-1 font-medium text-emerald-600"
                          : cls === "worst"
                            ? "border-b border-border/40 px-2 py-1 font-medium text-destructive"
                            : "border-b border-border/40 px-2 py-1 text-foreground"
                      }
                    >
                      {formatComparisonValue(r, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}
