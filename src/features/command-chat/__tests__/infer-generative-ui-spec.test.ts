/**
 * Verifies the auto-inference of generative-UI specs from known
 * reporting-tool outputs. When the user says "show me the funnel"
 * the brain calls `generate_funnel`; the chat layer auto-renders a
 * table without the tool having to know the renderer schema.
 */

import { describe, it, expect } from "vitest";

import { inferGenerativeUiSpec } from "../tool-policy";

describe("inferGenerativeUiSpec", () => {
  describe("generate_funnel → table", () => {
    it("renders a funnel as a 3-column table with pct percentages", () => {
      const out = {
        kind: "funnel",
        period: "30d",
        stages: [
          { stage: "applied", count: 100, pctOfTotal: 1.0 },
          { stage: "screened", count: 80, pctOfTotal: 0.8 },
          { stage: "approved", count: 25, pctOfTotal: 0.25 },
        ],
      };
      const spec = inferGenerativeUiSpec("generate_funnel", out);
      expect(spec).not.toBeNull();
      expect(spec?.kind).toBe("table");
      expect(spec?.type).toBe("table");
      const columns = spec?.columns as ReadonlyArray<{ key: string }>;
      expect(columns.map((c) => c.key)).toEqual(["stage", "count", "pct"]);
      const rows = spec?.rows as ReadonlyArray<{
        stage: string;
        count: number;
        pct: number;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ stage: "applied", count: 100, pct: 100 });
      expect(rows[2]).toEqual({ stage: "approved", count: 25, pct: 25 });
    });

    it("returns null when stages array is empty", () => {
      const spec = inferGenerativeUiSpec("generate_funnel", {
        kind: "funnel",
        period: "30d",
        stages: [],
      });
      expect(spec).toBeNull();
    });

    it("ignores malformed stage entries (wrong types) but keeps valid ones", () => {
      const out = {
        kind: "funnel",
        period: "30d",
        stages: [
          { stage: "applied", count: 100, pctOfTotal: 1.0 },
          { stage: 42, count: "bad", pctOfTotal: null }, // malformed
          { stage: "approved", count: 25, pctOfTotal: 0.25 },
        ],
      };
      const spec = inferGenerativeUiSpec("generate_funnel", out);
      const rows = spec?.rows as ReadonlyArray<unknown>;
      expect(rows).toHaveLength(2);
    });
  });

  describe("generate_cohort_report → table", () => {
    it("renders cohort buckets as a 2-column table", () => {
      const out = {
        kind: "cohort",
        cohort: "Jan 2026",
        period: "90d",
        metric: "retention",
        buckets: [
          { bucketLabel: "week 1", value: 0.92 },
          { bucketLabel: "week 4", value: 0.71 },
          { bucketLabel: "week 12", value: 0.54 },
        ],
      };
      const spec = inferGenerativeUiSpec("generate_cohort_report", out);
      expect(spec?.kind).toBe("table");
      expect(spec?.title).toContain("Jan 2026");
      expect(spec?.title).toContain("retention");
      const columns = spec?.columns as ReadonlyArray<{ label: string }>;
      expect(columns.map((c) => c.label)).toEqual(["Bucket", "retention"]);
      const rows = spec?.rows as ReadonlyArray<{ bucket: string }>;
      expect(rows).toHaveLength(3);
    });
  });

  describe("time_series_query → chart.recharts.timeseries", () => {
    it("renders a single-series chart when no groupBy is set", () => {
      const out = {
        kind: "time_series",
        metric: "active_users",
        period: "30d",
        points: [
          { t: "2026-01-01T00:00:00Z", v: 100 },
          { t: "2026-01-02T00:00:00Z", v: 105 },
          { t: "2026-01-03T00:00:00Z", v: 98 },
        ],
      };
      const spec = inferGenerativeUiSpec("time_series_query", out);
      expect(spec?.kind).toBe("chart.recharts.timeseries");
      expect(spec?.type).toBe("chart.recharts.timeseries");
      const series = spec?.series as ReadonlyArray<{
        name: string;
        data: ReadonlyArray<{ t: string; y: number }>;
      }>;
      expect(series).toHaveLength(1);
      expect(series[0].name).toBe("all");
      expect(series[0].data).toHaveLength(3);
      expect(series[0].data[0]).toEqual({ t: "2026-01-01T00:00:00Z", y: 100 });
    });

    it("buckets points into multiple series when groupBy is set", () => {
      const out = {
        kind: "time_series",
        metric: "applications",
        groupBy: "status",
        period: "30d",
        points: [
          { t: "2026-01-01T00:00:00Z", v: 10, group: "approved" },
          { t: "2026-01-01T00:00:00Z", v: 5, group: "rejected" },
          { t: "2026-01-02T00:00:00Z", v: 12, group: "approved" },
          { t: "2026-01-02T00:00:00Z", v: 3, group: "rejected" },
        ],
      };
      const spec = inferGenerativeUiSpec("time_series_query", out);
      const series = spec?.series as ReadonlyArray<{ name: string }>;
      expect(series.map((s) => s.name).sort()).toEqual([
        "approved",
        "rejected",
      ]);
      expect(spec?.title).toContain("applications");
      expect(spec?.title).toContain("status");
    });
  });

  describe("top_n_query → table", () => {
    it("renders rankings as a 3-column rank/key/value table", () => {
      const out = {
        kind: "ranking",
        entity: "officer",
        metric: "applications_handled",
        period: "7d",
        rows: [
          { rank: 1, key: "officer-a", value: 42 },
          { rank: 2, key: "officer-b", value: 31 },
          { rank: 3, key: "officer-c", value: 28 },
        ],
      };
      const spec = inferGenerativeUiSpec("top_n_query", out);
      expect(spec?.kind).toBe("table");
      expect(spec?.title).toContain("officer");
      expect(spec?.title).toContain("applications_handled");
      const columns = spec?.columns as ReadonlyArray<{ key: string }>;
      expect(columns.map((c) => c.key)).toEqual(["rank", "key", "value"]);
    });

    it("enables filterable when rows > 10", () => {
      const rows = Array.from({ length: 15 }, (_, i) => ({
        rank: i + 1,
        key: `officer-${i}`,
        value: 100 - i,
      }));
      const out = {
        kind: "ranking",
        entity: "officer",
        metric: "score",
        period: "30d",
        rows,
      };
      const spec = inferGenerativeUiSpec("top_n_query", out);
      expect(spec?.filterable).toBe(true);
    });
  });

  describe("unknown tool / malformed input", () => {
    it("returns null for an unknown tool name", () => {
      expect(
        inferGenerativeUiSpec("not_a_real_tool", { stages: [{}] }),
      ).toBeNull();
    });

    it("returns null for non-object result", () => {
      expect(inferGenerativeUiSpec("generate_funnel", null)).toBeNull();
      expect(inferGenerativeUiSpec("generate_funnel", "string")).toBeNull();
      expect(inferGenerativeUiSpec("generate_funnel", 42)).toBeNull();
    });

    it("returns null when expected array is missing", () => {
      expect(
        inferGenerativeUiSpec("time_series_query", { metric: "x" }),
      ).toBeNull();
    });
  });
});
