/**
 * Spec Builder — every output must pass `parseGenerativeUiSpec`.
 *
 * These tests prove that, given a typed fetch result for each
 * subject, the spec-builder produces a spec the closed registry can
 * render. No mocks of the schema layer — we use the real Zod parser.
 */

import { describe, expect, it } from "vitest";

import {
  parseGenerativeUiSpec,
  type GenerativeUiSpec,
} from "@/core/brain/generative-ui/types";
import { buildPresenterSpec, tierToBadge } from "../spec-builder";
import type { InlineDataFetchResult, InlineDataRequest } from "../types";

const TIER = "borjie-admin" as const;
const ISO = "2026-05-01T00:00:00.000Z";

function ensureRoundTrip(spec: GenerativeUiSpec): void {
  // The builder already runs parseGenerativeUiSpec at the boundary,
  // but we re-run it here so a regression that bypasses the parser
  // shows up as a test failure.
  expect(() => parseGenerativeUiSpec(spec)).not.toThrow();
}

describe("buildPresenterSpec — table", () => {
  it("builds a TableSpec for employees", () => {
    const request: InlineDataRequest = {
      kind: "table",
      subject: "employees",
    };
    const result: InlineDataFetchResult = {
      subject: "employees",
      generatedAt: ISO,
      tier: TIER,
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
    };
    const spec = buildPresenterSpec({ request, result });
    expect(spec.kind).toBe("table");
    if (spec.kind === "table") {
      expect(spec.columns.map((c) => c.key)).toContain("name");
      expect(spec.rows).toHaveLength(1);
    }
    ensureRoundTrip(spec);
  });

  it("builds a TableSpec for outstanding invoices", () => {
    const request: InlineDataRequest = {
      kind: "table",
      subject: "outstanding-invoices",
    };
    const result: InlineDataFetchResult = {
      subject: "outstanding-invoices",
      generatedAt: ISO,
      tier: TIER,
      rows: [
        {
          invoice_no: "INV-001",
          customer: "Acme",
          amount: 12345,
          due: "2026-04-01",
          days_overdue: 14,
        },
      ],
    };
    const spec = buildPresenterSpec({ request, result });
    expect(spec.kind).toBe("table");
    ensureRoundTrip(spec);
  });
});

describe("buildPresenterSpec — chart", () => {
  it("builds a RechartsTimeSeriesSpec when series are present", () => {
    const request: InlineDataRequest = {
      kind: "chart",
      subject: "sales-trend",
    };
    const result: InlineDataFetchResult = {
      subject: "sales-trend",
      generatedAt: ISO,
      tier: TIER,
      rows: [],
      series: [
        {
          name: "Revenue",
          data: [
            { t: "2026-01", y: 100 },
            { t: "2026-02", y: 120 },
          ],
        },
      ],
    };
    const spec = buildPresenterSpec({ request, result });
    expect(spec.kind).toBe("chart.recharts.timeseries");
    if (spec.kind === "chart.recharts.timeseries") {
      expect(spec.series).toHaveLength(1);
      expect(spec.series[0]?.data).toHaveLength(2);
    }
    ensureRoundTrip(spec);
  });

  it("falls back to markdown when no series", () => {
    const spec = buildPresenterSpec({
      request: { kind: "chart", subject: "sales-trend" },
      result: {
        subject: "sales-trend",
        generatedAt: ISO,
        tier: TIER,
        rows: [],
      },
    });
    expect(spec.kind).toBe("markdown");
    ensureRoundTrip(spec);
  });
});

describe("buildPresenterSpec — metric-grid", () => {
  it("builds a MetricGridSpec from explicit metrics", () => {
    const spec = buildPresenterSpec({
      request: { kind: "metric-grid", subject: "kpi-summary" },
      result: {
        subject: "kpi-summary",
        generatedAt: ISO,
        tier: TIER,
        rows: [],
        metrics: [
          { label: "MRR", value: 12_000, unit: "TZS" },
          { label: "Active customers", value: 42 },
        ],
      },
    });
    expect(spec.kind).toBe("metric.grid");
    if (spec.kind === "metric.grid") {
      expect(spec.metrics).toHaveLength(2);
    }
    ensureRoundTrip(spec);
  });

  it("synthesises a top-customer metric from rows when metrics are empty", () => {
    const spec = buildPresenterSpec({
      request: { kind: "metric-grid", subject: "top-customer" },
      result: {
        subject: "top-customer",
        generatedAt: ISO,
        tier: TIER,
        rows: [{ name: "Acme", segment: "B2B", ltv: 999_000 }],
      },
    });
    expect(spec.kind).toBe("metric.grid");
    if (spec.kind === "metric.grid") {
      expect(spec.metrics[0]?.label).toBe("Top customer");
      expect(spec.metrics[0]?.value).toBe("Acme");
    }
    ensureRoundTrip(spec);
  });
});

describe("buildPresenterSpec — diagram", () => {
  it("builds a MermaidSpec from org-chart nodes", () => {
    const spec = buildPresenterSpec({
      request: { kind: "diagram", subject: "org-chart" },
      result: {
        subject: "org-chart",
        generatedAt: ISO,
        tier: TIER,
        rows: [],
        orgChart: [
          { id: "u1", name: "Asha", role: "CEO", managerId: null },
          { id: "u2", name: "Ben", role: "COO", managerId: "u1" },
        ],
      },
    });
    expect(spec.kind).toBe("mermaid");
    if (spec.kind === "mermaid") {
      expect(spec.diagram).toContain("flowchart TD");
      expect(spec.diagram).toContain("Asha");
      expect(spec.diagram).toContain("Ben");
      expect(spec.diagram).toMatch(/u1\s*-->\s*u2/);
    }
    ensureRoundTrip(spec);
  });

  it("emits a placeholder when there are no nodes", () => {
    const spec = buildPresenterSpec({
      request: { kind: "diagram", subject: "org-chart" },
      result: {
        subject: "org-chart",
        generatedAt: ISO,
        tier: TIER,
        rows: [],
        orgChart: [],
      },
    });
    expect(spec.kind).toBe("mermaid");
    if (spec.kind === "mermaid") {
      expect(spec.diagram).toContain("No employees");
    }
    ensureRoundTrip(spec);
  });
});

describe("buildPresenterSpec — file-preview", () => {
  it("builds a MarkdownSpec for a PDF contract", () => {
    const spec = buildPresenterSpec({
      request: { kind: "file-preview", subject: "supplier-contract" },
      result: {
        subject: "supplier-contract",
        generatedAt: ISO,
        tier: TIER,
        rows: [],
        file: {
          storagePath: "contracts/acme.pdf",
          mimeType: "application/pdf",
          displayName: "Acme Supplier Agreement.pdf",
          signedUrl: "https://example.test/contracts/acme.pdf?sig=abc",
        },
      },
    });
    expect(spec.kind).toBe("markdown");
    if (spec.kind === "markdown") {
      expect(spec.markdown).toContain("PDF");
      expect(spec.markdown).toContain("Acme Supplier Agreement.pdf");
    }
    ensureRoundTrip(spec);
  });

  it("falls back to a not-found markdown when the file is missing", () => {
    const spec = buildPresenterSpec({
      request: { kind: "file-preview", subject: "supplier-contract" },
      result: {
        subject: "supplier-contract",
        generatedAt: ISO,
        tier: TIER,
        rows: [],
      },
    });
    expect(spec.kind).toBe("markdown");
    if (spec.kind === "markdown") {
      expect(spec.markdown.toLowerCase()).toContain("no matching document");
    }
    ensureRoundTrip(spec);
  });
});

describe("buildPresenterSpec — form", () => {
  it("builds a FormSpec for log-a-new-hire", () => {
    const spec = buildPresenterSpec({
      request: { kind: "form", subject: "employees" },
      result: {
        subject: "employees",
        generatedAt: ISO,
        tier: TIER,
        rows: [],
      },
    });
    expect(spec.kind).toBe("form");
    if (spec.kind === "form") {
      expect(spec.fields.map((f) => f.name)).toEqual(
        expect.arrayContaining(["name", "role", "department", "start_date"]),
      );
      expect(spec.submitAction.tool).toBe("create_employee");
    }
    ensureRoundTrip(spec);
  });
});

describe("tierToBadge", () => {
  it.each([
    ["sovereign", "sovereign"],
    ["borjie-admin", "borjie-admin"],
    ["org-admin", "borjie-admin"],
    ["officer", "supervised"],
    ["borrower", "sandbox"],
  ] as const)("maps %s -> %s", (input, expected) => {
    expect(tierToBadge(input)).toBe(expected);
  });
});
