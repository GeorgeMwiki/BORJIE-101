/**
 * Tool-policy helpers for command-chat.
 *
 * Centralised tier classification + generative-UI extraction. The
 * stream route uses these to decide whether to execute inline,
 * surface a confirm card, or four-eye gate.
 */

import type { ToolDefinition } from "@/core/borjie-ai/types";
import type { UiSenseEvent } from "@/core/brain/ui-sensing";

export type ToolTier = "read" | "write" | "destructive" | "sovereign";

/**
 * Classify a tool's tier. Conservative: any tool that requires
 * confirmation is treated as `write` at minimum. The optional
 * sovereign-tag list is provided by callers when known.
 *
 * Fail-closed contract (ported from Borjie PR #93 CRITICAL C1):
 *   When `tool.requiredPermissions` is undefined AND
 *   `tool.requiresConfirmation` is also undefined, we CANNOT prove the
 *   tool is read-only — the metadata is missing, not silent-permissive.
 *   In that case we return `"write"` (treat as mutating until proven
 *   otherwise) so the guard never defaults to a fully-permissive `read`
 *   classification when callers forget to wire the metadata.
 *
 * Callers that genuinely want a read tool must declare it explicitly
 * by setting `requiredPermissions: []` (empty array) AND
 * `requiresConfirmation: false`.
 */
export function classifyTier(
  tool: ToolDefinition,
  sovereignToolNames: ReadonlyArray<string> = [],
  destructiveToolNames: ReadonlyArray<string> = [],
): ToolTier {
  if (sovereignToolNames.includes(tool.name)) return "sovereign";
  if (destructiveToolNames.includes(tool.name)) return "destructive";
  const writePerm = (tool.requiredPermissions ?? []).some(
    (p: string) =>
      p.endsWith(".write") ||
      p.endsWith(".execute") ||
      p.endsWith(".manage") ||
      p.endsWith(".delete"),
  );
  if (tool.requiresConfirmation || writePerm) return "write";
  // Fail-closed default: missing metadata is treated as `write`. Only an
  // EXPLICIT empty `requiredPermissions: []` + `requiresConfirmation: false`
  // declares the tool as read-only.
  const explicitlyDeclaredReadOnly =
    Array.isArray(tool.requiredPermissions) &&
    tool.requiredPermissions.length === 0 &&
    tool.requiresConfirmation === false;
  return explicitlyDeclaredReadOnly ? "read" : "write";
}

/**
 * PII redactor for tool args before they cross the SSE boundary.
 * Strips common sensitive keys; the brain side still validates
 * server-side. Returns a new object — no mutation.
 */
export function redactArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const REDACT_KEYS = new Set([
    "password",
    "secret",
    "token",
    "ssn",
    "national_id",
    "tin",
    "card_number",
    "cvv",
    "pin",
    "otp",
    "api_key",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactArgs(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Pull a generative-UI spec off a tool result, if present. The
 * convention: tool result is `{ ui_block: { type, ... }, ... }` or
 * `{ generative_ui: { type, ... }, ... }`. Returns the spec or null.
 */
export function extractGenerativeUiSpec(
  result: unknown,
): { readonly type: string; readonly [k: string]: unknown } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const candidate =
    (r.ui_block as Record<string, unknown> | undefined) ??
    (r.generative_ui as Record<string, unknown> | undefined) ??
    (r.spec as Record<string, unknown> | undefined);
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.type !== "string") return null;
  return candidate as { readonly type: string; readonly [k: string]: unknown };
}

/**
 * Infer a generative-UI spec from a tool name + result, for known
 * reporting tools whose canonical output shape already maps to a
 * renderer. Returns null when no auto-mapping is registered for the
 * given tool — callers should fall back to `extractGenerativeUiSpec`.
 *
 * Side-effect-free + deterministic: given the same name + result it
 * always produces the same spec. The spec uses the generative-UI
 * registry's `kind` literals so it can be rendered by the closed
 * dispatch in `src/core/brain/generative-ui/registry.ts`.
 */
export function inferGenerativeUiSpec(
  toolName: string,
  result: unknown,
): { readonly type: string; readonly [k: string]: unknown } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  // generate_funnel → table (stage + count + pct)
  if (toolName === "generate_funnel" && Array.isArray(r.stages)) {
    const stages = r.stages as ReadonlyArray<{
      stage?: unknown;
      count?: unknown;
      pctOfTotal?: unknown;
    }>;
    const rows = stages
      .filter(
        (s) =>
          typeof s.stage === "string" &&
          typeof s.count === "number" &&
          typeof s.pctOfTotal === "number",
      )
      .map((s) => ({
        stage: s.stage as string,
        count: s.count as number,
        pct: Math.round((s.pctOfTotal as number) * 1000) / 10,
      }));
    if (rows.length === 0) return null;
    return Object.freeze({
      type: "table",
      kind: "table",
      title: `Funnel — ${rows.length} stages`,
      ariaLabel: `Funnel with ${rows.length} stages`,
      columns: [
        { key: "stage", label: "Stage" },
        { key: "count", label: "Count", format: "number", align: "right" },
        { key: "pct", label: "% of total", format: "number", align: "right" },
      ],
      rows,
      sortable: false,
      filterable: false,
    });
  }

  // generate_cohort_report → table (bucketLabel + value)
  if (toolName === "generate_cohort_report" && Array.isArray(r.buckets)) {
    const buckets = r.buckets as ReadonlyArray<{
      bucketLabel?: unknown;
      value?: unknown;
    }>;
    const cohort = typeof r.cohort === "string" ? r.cohort : "cohort";
    const metric = typeof r.metric === "string" ? r.metric : "metric";
    const rows = buckets
      .filter(
        (b) => typeof b.bucketLabel === "string" && typeof b.value === "number",
      )
      .map((b) => ({
        bucket: b.bucketLabel as string,
        value: b.value as number,
      }));
    if (rows.length === 0) return null;
    return Object.freeze({
      type: "table",
      kind: "table",
      title: `Cohort: ${cohort} (${metric})`,
      ariaLabel: `Cohort report ${cohort} by ${metric}, ${rows.length} buckets`,
      columns: [
        { key: "bucket", label: "Bucket" },
        { key: "value", label: metric, format: "number", align: "right" },
      ],
      rows,
      sortable: true,
      filterable: false,
    });
  }

  // time_series_query → recharts time-series
  if (toolName === "time_series_query" && Array.isArray(r.points)) {
    const points = r.points as ReadonlyArray<{
      t?: unknown;
      v?: unknown;
      group?: unknown;
    }>;
    const metric = typeof r.metric === "string" ? r.metric : "value";
    const groupBy = typeof r.groupBy === "string" ? r.groupBy : null;
    // Bucket by group (or single "all" if no groupBy).
    const seriesMap = new Map<string, Array<{ t: string; y: number }>>();
    for (const p of points) {
      if (typeof p.t !== "string" || typeof p.v !== "number") continue;
      const groupKey =
        typeof p.group === "string" && p.group.length > 0 ? p.group : "all";
      const arr = seriesMap.get(groupKey) ?? [];
      arr.push({ t: p.t, y: p.v });
      seriesMap.set(groupKey, arr);
    }
    if (seriesMap.size === 0) return null;
    const series = Array.from(seriesMap.entries()).map(([name, data]) => ({
      name,
      data,
    }));
    return Object.freeze({
      type: "chart.recharts.timeseries",
      kind: "chart.recharts.timeseries",
      title: groupBy ? `${metric} by ${groupBy}` : metric,
      ariaLabel: `${metric} over time, ${series.length} series, ${points.length} points`,
      series,
      yLabel: metric,
    });
  }

  // top_n_query → table (rank + key + value)
  if (toolName === "top_n_query" && Array.isArray(r.rows)) {
    const rows = (
      r.rows as ReadonlyArray<{
        rank?: unknown;
        key?: unknown;
        value?: unknown;
      }>
    )
      .filter(
        (row) =>
          typeof row.rank === "number" &&
          typeof row.key === "string" &&
          typeof row.value === "number",
      )
      .map((row) => ({
        rank: row.rank as number,
        key: row.key as string,
        value: row.value as number,
      }));
    if (rows.length === 0) return null;
    const entity = typeof r.entity === "string" ? r.entity : "entity";
    const metric = typeof r.metric === "string" ? r.metric : "metric";
    return Object.freeze({
      type: "table",
      kind: "table",
      title: `Top ${rows.length} ${entity} by ${metric}`,
      ariaLabel: `Top ${rows.length} ${entity} ranked by ${metric}`,
      columns: [
        { key: "rank", label: "#", format: "number", align: "right" },
        { key: "key", label: entity },
        { key: "value", label: metric, format: "number", align: "right" },
      ],
      rows,
      sortable: true,
      filterable: rows.length > 10,
    });
  }

  return null;
}

/**
 * Render a short, model-readable summary of the user's recent UI
 * activity. Captures: current route (last RouteEvent), recently
 * focused form field (last FocusEvent on a form element), recent
 * scroll depth on the current route, and any confusion signals
 * (rapid-edit / repeat-nav / idle-then-active).
 *
 * The summary is intentionally compact and PII-safe: it never
 * exposes raw field values (only field names) and never exposes
 * navigation searches with credentials (already stripped by the
 * ingest route).
 */
export function summariseRecentUiEvents(
  events: ReadonlyArray<UiSenseEvent>,
): string {
  if (events.length === 0) return "";

  // Walk events newest-last → oldest-first slice. The bus returns
  // events in chronological order (oldest first, newest last) so
  // `at(-1)` is the most recent. Defensive: skip events without a
  // `kind` discriminator.
  const newest = events[events.length - 1];
  if (!newest) return "";

  let currentRoute: string | null = null;
  let currentFocus: string | null = null;
  let lastFormField: string | null = null;
  let lastScrollDepth: number | null = null;
  const editCounts = new Map<string, number>();
  const routeCounts = new Map<string, number>();

  for (const ev of events) {
    switch (ev.kind) {
      case "route":
        currentRoute = ev.pathname;
        routeCounts.set(ev.pathname, (routeCounts.get(ev.pathname) ?? 0) + 1);
        break;
      case "focus":
        currentFocus = ev.fieldName ?? ev.target ?? null;
        break;
      case "form-field":
        if (ev.action === "change") {
          editCounts.set(ev.field, (editCounts.get(ev.field) ?? 0) + 1);
          lastFormField = ev.field;
        } else if (ev.action === "blur" || ev.action === "submit") {
          lastFormField = ev.field;
        }
        break;
      case "scroll":
        lastScrollDepth = ev.scrollDepth;
        break;
      case "cursor-idle":
        // Idle is a transient signal; we surface it only via the
        // confusion-pattern detector below.
        break;
      default:
        break;
    }
  }

  const confusionSignals: string[] = [];
  for (const [field, count] of editCounts.entries()) {
    if (count >= 3) {
      confusionSignals.push(`rapid edits on \`${field}\` (${count} changes)`);
    }
  }
  for (const [route, count] of routeCounts.entries()) {
    if (count >= 3) {
      confusionSignals.push(`re-visited \`${route}\` ${count} times`);
    }
  }

  const lines: string[] = ["## Recent UI activity"];
  if (currentRoute) {
    lines.push(`- Current route: \`${currentRoute}\``);
  }
  if (currentFocus) {
    lines.push(`- Currently focused: \`${currentFocus}\``);
  }
  if (lastFormField && lastFormField !== currentFocus) {
    lines.push(`- Most recently edited field: \`${lastFormField}\``);
  }
  if (lastScrollDepth !== null) {
    lines.push(`- Last scroll depth: ${Math.round(lastScrollDepth * 100)}%`);
  }
  if (confusionSignals.length > 0) {
    lines.push(`- Confusion signals: ${confusionSignals.join("; ")}`);
  }
  lines.push(
    "",
    'Use this context to anticipate the user\'s next ask: if they say "this page" or "this form", interpret against the current route + focused field above. NEVER quote raw field values you don\'t already have via a tool result; this summary only carries field NAMES.',
    "",
  );
  return lines.join("\n");
}

/**
 * Build the command-chat-specific section of the system policy. The
 * brain-kernel system policy is layered on top of this at call time.
 */
export function buildCommandChatSystemSection(opts: {
  readonly userRole: string;
  readonly availableToolNames: ReadonlyArray<string>;
  readonly recentUiEvents?: ReadonlyArray<UiSenseEvent>;
}): string {
  const uiSection = opts.recentUiEvents
    ? summariseRecentUiEvents(opts.recentUiEvents)
    : "";
  return [
    "# Command Chat",
    "",
    `You are operating as the central command brain for a borjie-admin (${opts.userRole}). The user is a privileged platform operator. You may use any of the tools available to you to:`,
    "- Manage users, organisations, and officers (read, create, update, suspend).",
    "- Inspect and operate applications, cases, and proposals.",
    "- Surface analytics, KPI charts, funnels, and time-series visualisations.",
    "- Search the audit trail by tenant, user, or time window.",
    "- Inspect and pause/resume cron / heartbeat jobs.",
    "- Run compliance checks and queue four-eye approvals.",
    "",
    "## Rules",
    "1. ALWAYS use tools instead of describing what you would do.",
    "2. Read tools execute immediately; write/destructive tools surface a confirm card; sovereign actions require four-eye approval.",
    "3. NEVER fabricate tool output. If a tool fails, surface the error.",
    "4. NEVER expose secrets, tokens, or raw PII in your final reply.",
    "5. NO em dashes in customer-facing text. Use commas, colons, periods, semicolons.",
    "",
    `Tools currently available: ${opts.availableToolNames.join(", ")}`,
    uiSection ? "\n" + uiSection : "",
  ].join("\n");
}
