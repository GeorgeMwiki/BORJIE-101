/**
 * Spec Builder — turns a `InlineDataFetchResult` + `InlineDataRequest`
 * into a typed, Zod-validated `GenerativeUiSpec`.
 *
 * The builder leans on the helpers in `@/core/brain/generative-ui` so
 * the resulting spec is guaranteed to pass the closed registry's
 * dispatch. Every output goes through `parseGenerativeUiSpec` at the
 * boundary — even though the per-kind builders already validate, the
 * final pass is a belt-and-braces check that catches accidental
 * mutation between build and emit.
 *
 * @module features/central-command/md/presenter/spec-builder
 */

import {
  buildMetricGrid,
  buildTable,
  buildTimeSeriesChart,
} from "@/core/brain/generative-ui/builders";
import {
  parseGenerativeUiSpec,
  type GenerativeUiSpec,
} from "@/core/brain/generative-ui/types";
import type { BorjieAITier } from "@/core/governance/tier-policy";

import { buildFilePreviewSpec } from "./file-preview";
import { buildOrgChartDiagram } from "./diagram-builder";
import {
  type InlineDataFetchResult,
  type InlineDataRequest,
  type InlineDataSubject,
} from "./types";

// ---------------------------------------------------------------------------
// Tier mapping
// ---------------------------------------------------------------------------

/**
 * Map a `BorjieAITier` to the narrower `TierBadgeSchema` used by the
 * source-trail UI. Tiers that don't have a 1:1 badge collapse to the
 * nearest semantic equivalent.
 */
export function tierToBadge(
  tier: BorjieAITier,
): "sandbox" | "supervised" | "borjie-admin" | "sovereign" {
  switch (tier) {
    case "sovereign":
      return "sovereign";
    case "borjie-admin":
      return "borjie-admin";
    case "org-admin":
      return "borjie-admin";
    case "officer":
      return "supervised";
    case "borrower":
      return "sandbox";
    default: {
      const _exhaustive: never = tier;
      void _exhaustive;
      return "sandbox";
    }
  }
}

function sourceTrail(result: InlineDataFetchResult) {
  return {
    generatedAt: result.generatedAt,
    sourceQueryHash: result.sourceQueryHash,
    tier: tierToBadge(result.tier),
  };
}

// ---------------------------------------------------------------------------
// Title helpers
// ---------------------------------------------------------------------------

const SUBJECT_TITLES: Record<InlineDataSubject, string> = Object.freeze({
  employees: "Team",
  team: "Team",
  customers: "Customers",
  "top-customer": "Top customer",
  "sales-trend": "Sales trend",
  revenue: "Revenue",
  "cash-position": "Cash position",
  "supplier-contract": "Supplier contract",
  "org-chart": "Org chart",
  "kpi-summary": "Business KPIs",
  expenses: "Expenses",
  "outstanding-invoices": "Outstanding invoices",
  "pending-approvals": "Pending approvals",
});

function deriveTitle(
  request: InlineDataRequest,
  result: InlineDataFetchResult,
): string {
  if (request.titleHint) return request.titleHint;
  const base = SUBJECT_TITLES[result.subject] ?? "Inline data";
  if (request.filters?.window) {
    const window = String(request.filters.window).replace(/_/g, " ");
    return `${base} — ${window}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Column maps
// ---------------------------------------------------------------------------

const TABLE_COLUMNS_BY_SUBJECT: Partial<
  Record<
    InlineDataSubject,
    ReadonlyArray<{
      readonly key: string;
      readonly label: string;
      readonly format?: "text" | "number" | "currency" | "date" | "datetime";
      readonly align?: "left" | "center" | "right";
    }>
  >
> = Object.freeze({
  employees: [
    { key: "name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "department", label: "Department" },
    { key: "last_one_on_one", label: "Last 1:1", format: "date" },
    { key: "sentiment", label: "Sentiment" },
    { key: "status", label: "Status" },
  ],
  team: [
    { key: "name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "department", label: "Department" },
    { key: "last_one_on_one", label: "Last 1:1", format: "date" },
    { key: "sentiment", label: "Sentiment" },
    { key: "status", label: "Status" },
  ],
  customers: [
    { key: "name", label: "Customer" },
    { key: "segment", label: "Segment" },
    { key: "ltv", label: "LTV", format: "currency", align: "right" },
    { key: "last_order", label: "Last order", format: "date" },
    { key: "status", label: "Status" },
  ],
  "outstanding-invoices": [
    { key: "invoice_no", label: "Invoice" },
    { key: "customer", label: "Customer" },
    { key: "amount", label: "Amount", format: "currency", align: "right" },
    { key: "due", label: "Due", format: "date" },
    {
      key: "days_overdue",
      label: "Days overdue",
      format: "number",
      align: "right",
    },
  ],
  "pending-approvals": [
    { key: "kind", label: "Kind" },
    { key: "requested_by", label: "Requested by" },
    { key: "requested_at", label: "Requested", format: "datetime" },
    { key: "summary", label: "Summary" },
  ],
});

// ---------------------------------------------------------------------------
// Build entry
// ---------------------------------------------------------------------------

export interface SpecBuilderInput {
  readonly request: InlineDataRequest;
  readonly result: InlineDataFetchResult;
}

/**
 * Build a `GenerativeUiSpec` from the fetched data. Always returns a
 * Zod-validated spec; throws on schema failure (the caller treats
 * that as a hard bug, not a recoverable runtime condition).
 */
export function buildPresenterSpec(input: SpecBuilderInput): GenerativeUiSpec {
  const { request, result } = input;
  const title = deriveTitle(request, result);
  const source = sourceTrail(result);

  // The presenter kind dictates the renderer; subject narrows the
  // payload shape. We compute both and let the per-kind builder
  // enforce Zod.
  switch (request.kind) {
    case "table": {
      const columns = TABLE_COLUMNS_BY_SUBJECT[result.subject] ?? [
        { key: "name", label: "Name" },
      ];
      const spec = buildTable({
        title,
        columns,
        rows: result.rows,
        sortable: true,
        filterable: result.rows.length > 10,
        ariaLabel: `${title} — ${result.rows.length} rows`,
        source,
      });
      return parseGenerativeUiSpec(spec);
    }
    case "chart": {
      const series = result.series ?? [];
      if (series.length === 0) {
        // Fall through to an empty markdown summary so the chat
        // always renders something useful — the registry's
        // markdown renderer handles this gracefully.
        return parseGenerativeUiSpec({
          kind: "markdown",
          title,
          markdown: "No time-series data available for the requested window.",
          ariaLabel: `${title}: no data`,
          source,
        });
      }
      const spec = buildTimeSeriesChart({
        title,
        series,
        ariaLabel: `${title} time series, ${series.length} series`,
        yLabel: title,
        source,
      });
      return parseGenerativeUiSpec(spec);
    }
    case "metric-grid": {
      const metrics = result.metrics ?? [];
      if (metrics.length === 0) {
        // Top-customer falls into this branch when the customer
        // list is non-empty — synthesise a single metric from the
        // first row.
        const first = result.rows[0];
        if (first && typeof first.name === "string") {
          const synth = [
            {
              label: "Top customer",
              value: first.name,
              unit: undefined,
              trend: undefined,
              delta: undefined,
            },
            ...(typeof first.ltv === "number"
              ? [
                  {
                    label: "LTV (TZS)",
                    value: first.ltv,
                    unit: "TZS",
                    trend: undefined,
                    delta: undefined,
                  },
                ]
              : []),
          ];
          const spec = buildMetricGrid({
            title,
            metrics: synth,
            ariaLabel: `${title}: ${first.name}`,
            source,
          });
          return parseGenerativeUiSpec(spec);
        }
        return parseGenerativeUiSpec({
          kind: "markdown",
          title,
          markdown: "No KPI data available right now.",
          ariaLabel: `${title}: no data`,
          source,
        });
      }
      const spec = buildMetricGrid({
        title,
        metrics,
        columns: Math.min(4, Math.max(1, metrics.length)),
        ariaLabel: `${title} — ${metrics.length} KPIs`,
        source,
      });
      return parseGenerativeUiSpec(spec);
    }
    case "diagram": {
      const nodes = result.orgChart ?? [];
      const spec = buildOrgChartDiagram({
        nodes,
        titleHint: title,
        tier: result.tier,
        generatedAt: result.generatedAt,
      });
      return parseGenerativeUiSpec(spec);
    }
    case "file-preview": {
      if (!result.file) {
        return parseGenerativeUiSpec({
          kind: "markdown",
          title,
          markdown: "No matching document found in storage.",
          ariaLabel: `${title}: missing file`,
          source,
        });
      }
      const spec = buildFilePreviewSpec({
        file: result.file,
        titleHint: title,
        tier: result.tier,
        generatedAt: result.generatedAt,
      });
      return parseGenerativeUiSpec(spec);
    }
    case "form": {
      // Capture-style asks: emit a minimal form for "log a new hire".
      // Subject is `employees` in MVP; future captures plug in here.
      return parseGenerativeUiSpec({
        kind: "form",
        title: title || "New hire",
        description: "Log a new hire. Submits via the `create_employee` tool.",
        ariaLabel: "New hire form",
        fields: [
          {
            name: "name",
            kind: "text",
            label: "Full name",
            required: true,
          },
          {
            name: "role",
            kind: "text",
            label: "Role",
            required: true,
          },
          {
            name: "department",
            kind: "select",
            label: "Department",
            options: [
              { value: "engineering", label: "Engineering" },
              { value: "sales", label: "Sales" },
              { value: "ops", label: "Operations" },
              { value: "finance", label: "Finance" },
              { value: "hr", label: "HR" },
            ],
            required: true,
          },
          {
            name: "start_date",
            kind: "date",
            label: "Start date",
            required: true,
          },
        ],
        submitAction: { tool: "create_employee" },
        cancelable: true,
        submitLabel: "Log hire",
        cancelLabel: "Cancel",
        source,
      });
    }
    default: {
      const _exhaustive: never = request.kind;
      void _exhaustive;
      return parseGenerativeUiSpec({
        kind: "markdown",
        title,
        markdown: "Unsupported presenter kind.",
        source,
      });
    }
  }
}
