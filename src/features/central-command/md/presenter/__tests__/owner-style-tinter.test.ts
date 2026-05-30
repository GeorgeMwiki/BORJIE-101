/**
 * Owner-Style Tinter — terse / balanced / verbose transformations.
 *
 * These tests assert immutability + Zod validity of the tinted spec.
 * The tinter must NEVER mutate its input.
 */

import { describe, expect, it } from "vitest";

import {
  buildTable,
  buildTimeSeriesChart,
  buildMetricGrid,
} from "@/core/brain/generative-ui/builders";
import { parseGenerativeUiSpec } from "@/core/brain/generative-ui/types";

import { tintForOwnerStyle } from "../owner-style-tinter";

describe("tintForOwnerStyle — table", () => {
  const richTable = buildTable({
    title: "Team",
    columns: [
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "department", label: "Department" },
      { key: "last_one_on_one", label: "Last 1:1" },
      { key: "sentiment", label: "Sentiment" },
      { key: "status", label: "Status" },
    ],
    rows: [
      {
        name: "Asha",
        role: "Engineer",
        department: "engineering",
        last_one_on_one: "2026-04-30",
        sentiment: "positive",
        status: "active",
      },
    ],
  });

  it("returns the same spec for balanced", () => {
    const out = tintForOwnerStyle({ spec: richTable, hint: "balanced" });
    expect(out).toBe(richTable);
  });

  it("trims columns for terse hint", () => {
    const out = tintForOwnerStyle({ spec: richTable, hint: "terse" });
    expect(out.kind).toBe("table");
    if (out.kind === "table") {
      expect(out.columns.length).toBeLessThanOrEqual(3);
      expect(out.columns[0]?.key).toBe("name");
      // Rows reflect the projection.
      expect(Object.keys(out.rows[0] ?? {})).toEqual(
        out.columns.map((c) => c.key),
      );
    }
    // Must still pass the registry's Zod parse.
    expect(() => parseGenerativeUiSpec(out)).not.toThrow();
  });

  it("appends a narrative summary to the title for verbose hint", () => {
    const out = tintForOwnerStyle({ spec: richTable, hint: "verbose" });
    expect(out.kind).toBe("table");
    if (out.kind === "table") {
      expect(out.title).toContain("Team");
      expect(out.title).toMatch(/row|Columns/);
    }
    expect(() => parseGenerativeUiSpec(out)).not.toThrow();
  });

  it("does not mutate the input spec", () => {
    const snapshot = JSON.stringify(richTable);
    tintForOwnerStyle({ spec: richTable, hint: "terse" });
    tintForOwnerStyle({ spec: richTable, hint: "verbose" });
    expect(JSON.stringify(richTable)).toBe(snapshot);
  });
});

describe("tintForOwnerStyle — chart", () => {
  const multiSeries = buildTimeSeriesChart({
    title: "Sales",
    series: [
      { name: "Revenue", data: [{ t: "2026-01", y: 100 }] },
      { name: "Costs", data: [{ t: "2026-01", y: 60 }] },
    ],
  });

  it("collapses to the headline series for terse hint", () => {
    const out = tintForOwnerStyle({ spec: multiSeries, hint: "terse" });
    expect(out.kind).toBe("chart.recharts.timeseries");
    if (out.kind === "chart.recharts.timeseries") {
      expect(out.series).toHaveLength(1);
      expect(out.series[0]?.name).toBe("Revenue");
    }
    expect(() => parseGenerativeUiSpec(out)).not.toThrow();
  });

  it("adds narrative to the title for verbose hint", () => {
    const out = tintForOwnerStyle({ spec: multiSeries, hint: "verbose" });
    expect(out.kind).toBe("chart.recharts.timeseries");
    if (out.kind === "chart.recharts.timeseries") {
      expect(out.title).toContain("Plotting");
    }
    expect(() => parseGenerativeUiSpec(out)).not.toThrow();
  });
});

describe("tintForOwnerStyle — metric-grid", () => {
  const grid = buildMetricGrid({
    title: "KPIs",
    metrics: [
      { label: "A", value: 1, sparkline: [1, 2, 3] },
      { label: "B", value: 2, sparkline: [4, 5, 6] },
      { label: "C", value: 3 },
      { label: "D", value: 4 },
      { label: "E", value: 5 },
    ],
  });

  it("trims to 3 metrics and drops sparklines for terse hint", () => {
    const out = tintForOwnerStyle({ spec: grid, hint: "terse" });
    expect(out.kind).toBe("metric.grid");
    if (out.kind === "metric.grid") {
      expect(out.metrics).toHaveLength(3);
      for (const m of out.metrics) {
        expect(m.sparkline).toBeUndefined();
      }
    }
    expect(() => parseGenerativeUiSpec(out)).not.toThrow();
  });

  it("leaves balanced grids untouched", () => {
    const out = tintForOwnerStyle({ spec: grid, hint: "balanced" });
    expect(out).toBe(grid);
  });
});

describe("tintForOwnerStyle — passthrough kinds", () => {
  it("leaves a mermaid spec alone", () => {
    const mermaid = parseGenerativeUiSpec({
      kind: "mermaid",
      title: "Org",
      diagram: "flowchart TD\n  a-->b",
    });
    const out = tintForOwnerStyle({ spec: mermaid, hint: "terse" });
    expect(out).toBe(mermaid);
  });

  it("leaves a markdown spec alone", () => {
    const md = parseGenerativeUiSpec({
      kind: "markdown",
      title: "Doc",
      markdown: "PDF: [doc](https://example.test/doc.pdf)",
    });
    const out = tintForOwnerStyle({ spec: md, hint: "verbose" });
    expect(out).toBe(md);
  });
});
