/**
 * Client-side Zod schemas for every AG-UI UiPart payload.
 *
 * Mirrors the server-side schemas in
 * `packages/central-intelligence/src/kernel/tools/render-blocks/schemas.ts`
 * so the client can re-validate every payload at the render boundary.
 *
 * Belt-and-suspenders. The server already validates before emit, but
 * defense in depth: a compromised or out-of-date server build should
 * never crash the admin console.
 */

import { z } from "zod";

const CurrencySchema = z.enum(["KES", "TZS", "USD"]);

const Iso8601Schema = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be ISO-8601 parseable");

const LatLngSchema = z.tuple([
  z.number().gte(-90).lte(90),
  z.number().gte(-180).lte(180),
]);

// chart-vega
export const ChartVegaPartSchema = z
  .object({
    kind: z.literal("chart-vega"),
    title: z.string().max(200).optional(),
    spec: z.record(z.unknown()),
    data: z.array(z.record(z.unknown())).max(100_000),
  })
  .strict();

// data-table
export const DataTableColumnSchema = z
  .object({
    id: z.string().min(1).max(120),
    header: z.string().min(1).max(200),
    accessorKey: z.string().min(1).max(200),
    format: z
      .enum(["text", "currency", "percent", "number", "date"])
      .optional(),
    currency: CurrencySchema.optional(),
    enableSorting: z.boolean().optional(),
  })
  .strict();

export const DataTablePartSchema = z
  .object({
    kind: z.literal("data-table"),
    title: z.string().max(200).optional(),
    columns: z.array(DataTableColumnSchema).min(1).max(50),
    rows: z.array(z.record(z.unknown())).max(50_000),
    pageSize: z.number().int().min(1).max(500).optional(),
  })
  .strict();

// timeline
export const TimelineEventSchema = z
  .object({
    timestamp: Iso8601Schema,
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    severity: z.enum(["info", "warn", "error", "success"]).optional(),
    icon: z.string().max(60).optional(),
  })
  .strict();

export const TimelinePartSchema = z
  .object({
    kind: z.literal("timeline"),
    title: z.string().max(200).optional(),
    events: z.array(TimelineEventSchema).min(1).max(500),
  })
  .strict();

// kpi-grid
export const KpiTileSchema = z
  .object({
    label: z.string().min(1).max(120),
    value: z.union([z.number(), z.string().max(80)]),
    delta: z.number().optional(),
    deltaDirection: z.enum(["up", "down", "flat"]).optional(),
    format: z.enum(["currency", "percent", "number"]),
    currency: CurrencySchema.optional(),
  })
  .strict();

export const KpiGridPartSchema = z
  .object({
    kind: z.literal("kpi-grid"),
    title: z.string().max(200).optional(),
    tiles: z.array(KpiTileSchema).min(1).max(24),
  })
  .strict();

// prefill-form
export const PrefillFormPartSchema = z
  .object({
    kind: z.literal("prefill-form"),
    title: z.string().max(200).optional(),
    formId: z.string().min(1).max(120),
    schemaJson: z.record(z.unknown()),
    values: z.record(z.unknown()),
    action: z.string().min(1).max(500),
    diffMode: z.boolean().optional(),
  })
  .strict();

// approval
export const ApprovalPartSchema = z
  .object({
    kind: z.literal("approval"),
    title: z.string().max(200).optional(),
    action: z.string().min(1).max(200),
    payload: z.record(z.unknown()),
    diff: z.record(z.unknown()),
    checklist: z.tuple([
      z.string().min(1).max(280),
      z.string().min(1).max(280),
      z.string().min(1).max(280),
      z.string().min(1).max(280),
      z.string().min(1).max(280),
    ]),
  })
  .strict();

// workflow
export const WorkflowStepSchema = z
  .object({
    label: z.string().min(1).max(120),
    status: z.enum(["pending", "running", "done", "failed"]),
    startedAt: Iso8601Schema.optional(),
    completedAt: Iso8601Schema.optional(),
  })
  .strict();

export const WorkflowPartSchema = z
  .object({
    kind: z.literal("workflow"),
    title: z.string().max(200).optional(),
    steps: z.array(WorkflowStepSchema).min(1).max(40),
    currentIndex: z.number().int().min(0),
  })
  .strict();

// map
export const MapMarkerSchema = z
  .object({
    position: LatLngSchema,
    popup: z.string().max(500).optional(),
  })
  .strict();

export const MapPartSchema = z
  .object({
    kind: z.literal("map"),
    title: z.string().max(200).optional(),
    center: LatLngSchema,
    zoom: z.number().int().min(0).max(20),
    markers: z.array(MapMarkerSchema).max(2000),
  })
  .strict();

// calendar
export const CalendarEventSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    start: Iso8601Schema,
    end: Iso8601Schema.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional(),
  })
  .strict();

export const CalendarPartSchema = z
  .object({
    kind: z.literal("calendar"),
    title: z.string().max(200).optional(),
    events: z.array(CalendarEventSchema).max(5000),
    view: z.enum(["dayGrid", "timeGrid", "list"]).optional(),
  })
  .strict();

// file-preview
// iter-50-final L4 fix: `url` flows into `<a href>` for the PDF and
// generic-file branches AND into `<img src>` for the image branch.
// Restrict to http(s) and path-relative ONLY — explicitly REJECT
// `data:` and `blob:` schemes which a hostile spec could use to
// open an attacker-controlled or in-memory payload in the new tab
// (`target="_blank"`).
export const FilePreviewPartSchema = z
  .object({
    kind: z.literal("file-preview"),
    title: z.string().max(200).optional(),
    url: z
      .string()
      .min(1)
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u) || u.startsWith("/"), {
        message: "url must be http(s) or path-relative (no data:/blob:)",
      }),
    mimeType: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

// ═════════════════════════════════════════════════════════════════════
// ProdFix-7 — 12 new UiPart kinds
// ═════════════════════════════════════════════════════════════════════

// ISO-4217 regex (ProdFix-2 widening). Reserved for ProdFix-7 kinds that
// don't need to be backwards-compatible with the older Currency enum.
const Iso4217Schema = z
  .string()
  .regex(/^[A-Z]{3}$/, "ISO-4217 currency code (3 upper-case letters)");

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "must be hex colour, e.g. #1f6feb");

// ── 11. kanban ────────────────────────────────────────────────────────

export const KanbanCardSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(200).optional(),
    badges: z.array(z.string().min(1).max(60)).max(8).optional(),
    meta: z.record(z.union([z.string().max(200), z.number()])).optional(),
    dueAt: Iso8601Schema.optional(),
  })
  .strict();

export const KanbanColumnSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    cards: z.array(KanbanCardSchema).max(500),
  })
  .strict();

export const KanbanPartSchema = z
  .object({
    kind: z.literal("kanban"),
    title: z.string().max(200).optional(),
    columns: z.array(KanbanColumnSchema).min(1).max(8),
  })
  .strict();

// ── 12. dashboard-grid ────────────────────────────────────────────────

export const DashboardGridCellSchema = z
  .object({
    span: z.number().int().min(1).max(12),
    part: z.object({ kind: z.string().min(1).max(60) }).passthrough(),
  })
  .strict();

export const DashboardGridPartSchema = z
  .object({
    kind: z.literal("dashboard-grid"),
    title: z.string().max(200).optional(),
    cells: z.array(DashboardGridCellSchema).min(1).max(32),
  })
  .strict();

// ── 13. heatmap ───────────────────────────────────────────────────────

export const HeatmapPartSchema = z
  .object({
    kind: z.literal("heatmap"),
    title: z.string().max(200).optional(),
    xAxis: z.array(z.string().min(1).max(120)).min(1).max(200),
    yAxis: z.array(z.string().min(1).max(120)).min(1).max(200),
    cells: z.array(z.array(z.number())).min(1).max(200),
    colorScale: z.enum(["linear", "log", "diverging"]),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    format: z.enum(["currency", "percent", "count"]),
    currency: Iso4217Schema.optional(),
    unit: z.string().max(40).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.format === "currency" && !p.currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "currency required when format=currency",
        path: ["currency"],
      });
    }
    if (p.cells.length !== p.yAxis.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cells.length must equal yAxis.length",
        path: ["cells"],
      });
    }
    for (const [i, row] of p.cells.entries()) {
      if (row.length !== p.xAxis.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `cells[${i}].length must equal xAxis.length`,
          path: ["cells", i],
        });
      }
    }
  });

// ── 14. markdown-card ─────────────────────────────────────────────────

export const MarkdownCitationSchema = z
  .object({
    id: z.string().min(1).max(60),
    label: z.string().min(1).max(200),
    sourceUri: z.string().max(2000).optional(),
    sourceRowRef: z.string().max(200).optional(),
  })
  .strict();

export const MarkdownCardPartSchema = z
  .object({
    kind: z.literal("markdown-card"),
    title: z.string().max(200).optional(),
    markdown: z.string().min(1).max(20_000),
    citations: z.array(MarkdownCitationSchema).max(50).optional(),
    severity: z.enum(["info", "warning", "success", "danger"]).optional(),
  })
  .strict();

// ── 15. prompt-suggestions ────────────────────────────────────────────

export const PromptSuggestionSchema = z
  .object({
    label: z.string().min(1).max(120),
    prompt: z.string().min(1).max(2000),
    kind: z.enum(["primary", "secondary", "destructive"]),
    icon: z.string().max(60).optional(),
  })
  .strict();

export const PromptSuggestionsPartSchema = z
  .object({
    kind: z.literal("prompt-suggestions"),
    title: z.string().max(200).optional(),
    suggestions: z.array(PromptSuggestionSchema).min(1).max(12),
  })
  .strict();

// ── 16. evidence-card ─────────────────────────────────────────────────

export const EvidenceCardPartSchema = z
  .object({
    kind: z.literal("evidence-card"),
    title: z.string().max(200).optional(),
    quote: z.string().min(1).max(4000),
    sourceTitle: z.string().min(1).max(200),
    sourceUri: z.string().max(2000).optional(),
    sourcePageOrLocator: z.string().max(120).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    extractedAt: Iso8601Schema.optional(),
  })
  .strict();

// ── 17. tree ──────────────────────────────────────────────────────────

const TreeActionSchema = z
  .object({
    kind: z.enum(["message", "tool", "navigate"]),
    payload: z.record(z.unknown()),
  })
  .strict();

export type TreeNodeShape = {
  id: string;
  label: string;
  badge?: string;
  children?: TreeNodeShape[];
  onClickAction?: z.infer<typeof TreeActionSchema>;
};

// Note: Zod 3's recursive `.lazy(...)` schema inference doesn't line up
// with our declared `TreeNodeShape` under strict module-resolution
// (nodenext/node16) downstream consumers. We declare the schema with a
// `z.ZodType<TreeNodeShape>` annotation AND cast the `.lazy()` return so
// both directions agree. Runtime parsing returns a properly-typed
// TreeNodeShape because Zod resolves at parse time.
export const TreeNodeSchema: z.ZodType<TreeNodeShape> = z.lazy(
  () =>
    z
      .object({
        id: z.string().min(1).max(120),
        label: z.string().min(1).max(200),
        badge: z.string().max(60).optional(),
        children: z.array(TreeNodeSchema).max(500).optional(),
        onClickAction: TreeActionSchema.optional(),
      })
      .strict() as unknown as z.ZodType<TreeNodeShape>,
);

export const TreePartSchema = z
  .object({
    kind: z.literal("tree"),
    title: z.string().max(200).optional(),
    root: TreeNodeSchema,
  })
  .strict();

// ── 18. diff-view ─────────────────────────────────────────────────────

export const DiffViewPartSchema = z
  .object({
    kind: z.literal("diff-view"),
    title: z.string().max(200).optional(),
    left: z.string().max(50_000),
    right: z.string().max(50_000),
    leftLabel: z.string().min(1).max(120),
    rightLabel: z.string().min(1).max(120),
    mode: z.enum(["unified", "split"]),
    language: z.enum(["text", "json", "sql"]).optional(),
  })
  .strict();

// ── 19. gauge ─────────────────────────────────────────────────────────

const GaugeThresholdSchema = z
  .object({
    value: z.number(),
    color: HexColorSchema,
  })
  .strict();

export const GaugePartSchema = z
  .object({
    kind: z.literal("gauge"),
    title: z.string().max(200).optional(),
    value: z.number(),
    min: z.number(),
    max: z.number(),
    label: z.string().min(1).max(120),
    format: z.enum(["percent", "number", "currency"]).optional(),
    currency: Iso4217Schema.optional(),
    thresholds: z.array(GaugeThresholdSchema).max(8).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.min >= p.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min must be less than max",
        path: ["min"],
      });
    }
    if (p.format === "currency" && !p.currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "currency required when format=currency",
        path: ["currency"],
      });
    }
  });

// ── 20. metric-sparkline ──────────────────────────────────────────────

export const MetricSparklinePartSchema = z
  .object({
    kind: z.literal("metric-sparkline"),
    title: z.string().max(200).optional(),
    label: z.string().min(1).max(120),
    value: z.number(),
    format: z.enum(["currency", "percent", "number"]),
    currency: Iso4217Schema.optional(),
    sparkline: z.array(z.number()).min(2).max(500),
    delta: z.number().optional(),
    deltaIsPositive: z.boolean().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.format === "currency" && !p.currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "currency required when format=currency",
        path: ["currency"],
      });
    }
  });

// ── 21. image-annotation ──────────────────────────────────────────────

export const ImageAnnotationSchema = z
  .object({
    x: z.number().gte(0).lte(1),
    y: z.number().gte(0).lte(1),
    label: z.string().min(1).max(200),
    severity: z.enum(["info", "warning", "critical"]),
  })
  .strict();

// iter-50-final L4 fix: `imageUrl` flows ONLY into `<img src>` for the
// annotated-image overlay — never into a link — so the `data:image/`
// scheme is intentionally permitted for inline previews of base64-encoded
// images (e.g. AXTree captures). If a future refactor pipes this value
// into an `<a href>`, narrow the refine to http(s)+path-relative as in
// FilePreview.
export const ImageAnnotationPartSchema = z
  .object({
    kind: z.literal("image-annotation"),
    title: z.string().max(200).optional(),
    imageUrl: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (u) =>
          /^https?:\/\//.test(u) ||
          u.startsWith("/") ||
          u.startsWith("data:image/"),
        "imageUrl must be http(s), path-relative, or data:image/",
      ),
    annotations: z.array(ImageAnnotationSchema).max(200),
  })
  .strict();

// ── 22. signature-pad ─────────────────────────────────────────────────

const SignatureActionSchema = z
  .object({
    kind: z.enum(["tool", "navigate"]),
    payload: z.record(z.unknown()),
  })
  .strict();

export const SignaturePadPartSchema = z
  .object({
    kind: z.literal("signature-pad"),
    title: z.string().max(200).optional(),
    prompt: z.string().min(1).max(1000),
    requiredFor: z.string().min(1).max(200),
    onSubmitAction: SignatureActionSchema,
  })
  .strict();

// ═════════════════════════════════════════════════════════════════════
// Phase E.7 — 13 new UiPart kinds (ProdFix-7 deferred → ProdFix-8)
// ═════════════════════════════════════════════════════════════════════

// ── 23. pdf-viewer ────────────────────────────────────────────────────

export const PdfViewerPartSchema = z
  .object({
    kind: z.literal("pdf-viewer"),
    title: z.string().max(200).optional(),
    url: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (u) => /^https?:\/\//.test(u) || u.startsWith("/"),
        "url must be http(s) or path-relative",
      ),
    name: z.string().min(1).max(200),
    initialPage: z.number().int().min(1).max(10_000).optional(),
    allowAnnotate: z.boolean().optional(),
  })
  .strict();

// ── 24. slider-input ──────────────────────────────────────────────────

const SliderChangeActionSchema = z
  .object({
    kind: z.enum(["tool", "message"]),
    payload: z.record(z.unknown()),
  })
  .strict();

export const SliderInputPartSchema = z
  .object({
    kind: z.literal("slider-input"),
    title: z.string().max(200).optional(),
    label: z.string().min(1).max(200),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    value: z.number(),
    format: z.enum(["number", "currency", "percent"]).optional(),
    currency: Iso4217Schema.optional(),
    onChangeAction: SliderChangeActionSchema,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.min >= p.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min must be less than max",
        path: ["min"],
      });
    }
    if (p.format === "currency" && !p.currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "currency required when format=currency",
        path: ["currency"],
      });
    }
  });

// ── 25. multistep-wizard ──────────────────────────────────────────────

export const WizardFieldSchema = z
  .object({
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    type: z.enum(["text", "number", "select", "textarea", "checkbox"]),
    options: z
      .array(
        z
          .object({
            label: z.string().min(1).max(200),
            value: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    required: z.boolean().optional(),
  })
  .strict();

export const WizardStepSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    fields: z.array(WizardFieldSchema).max(40),
  })
  .strict();

export const MultistepWizardPartSchema = z
  .object({
    kind: z.literal("multistep-wizard"),
    title: z.string().max(200).optional(),
    steps: z.array(WizardStepSchema).min(1).max(20),
    currentStepId: z.string().max(120).optional(),
    values: z.record(z.unknown()).optional(),
    onSubmitAction: z.string().min(1).max(500),
  })
  .strict();

// ── 26. media-grid ────────────────────────────────────────────────────

// iter-50-final L4 fix: `url` here flows ONLY into `<img src>` (thumbnail
// grid + lightbox modal) — never into an `<a href>` — so the `data:`
// scheme is intentionally permitted for inline previews of base64-encoded
// images and bookmarklets. If a future refactor pipes this value into a
// link, narrow the refine to http(s)+path-relative as in FilePreview.
export const MediaGridItemSchema = z
  .object({
    id: z.string().min(1).max(120),
    url: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (u) =>
          /^https?:\/\//.test(u) || u.startsWith("/") || u.startsWith("data:"),
        "url must be http(s), path-relative, or data:",
      ),
    thumbUrl: z.string().max(2000).optional(),
    caption: z.string().max(500).optional(),
    takenAt: Iso8601Schema.optional(),
    mimeType: z.string().max(120).optional(),
  })
  .strict();

export const MediaGridPartSchema = z
  .object({
    kind: z.literal("media-grid"),
    title: z.string().max(200).optional(),
    items: z.array(MediaGridItemSchema).min(1).max(500),
    columns: z.number().int().min(1).max(8).optional(),
  })
  .strict();

// ── 27. chat-embed ────────────────────────────────────────────────────

export const ChatEmbedMessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    text: z.string().min(1).max(8000),
  })
  .strict();

export const ChatEmbedPartSchema = z
  .object({
    kind: z.literal("chat-embed"),
    title: z.string().max(200).optional(),
    scope: z.string().min(1).max(200),
    placeholder: z.string().max(200).optional(),
    initialMessages: z.array(ChatEmbedMessageSchema).max(50).optional(),
  })
  .strict();

// ── 28. live-counter ──────────────────────────────────────────────────

export const LiveCounterPartSchema = z
  .object({
    kind: z.literal("live-counter"),
    title: z.string().max(200).optional(),
    label: z.string().min(1).max(200),
    value: z.number(),
    unit: z.string().max(40).optional(),
    trend: z.enum(["up", "down", "flat"]).optional(),
    thresholdWarn: z.number().optional(),
    thresholdCritical: z.number().optional(),
    updatedAt: Iso8601Schema.optional(),
  })
  .strict();

// ── 29. org-chart ─────────────────────────────────────────────────────

export type OrgChartNodeShape = {
  id: string;
  label: string;
  role?: string;
  badge?: string;
  children?: OrgChartNodeShape[];
};

export const OrgChartNodeSchema: z.ZodType<OrgChartNodeShape> = z.lazy(
  () =>
    z
      .object({
        id: z.string().min(1).max(120),
        label: z.string().min(1).max(200),
        role: z.string().max(120).optional(),
        badge: z.string().max(60).optional(),
        children: z.array(OrgChartNodeSchema).max(200).optional(),
      })
      .strict() as unknown as z.ZodType<OrgChartNodeShape>,
);

export const OrgChartPartSchema = z
  .object({
    kind: z.literal("org-chart"),
    title: z.string().max(200).optional(),
    root: OrgChartNodeSchema,
    orientation: z.enum(["vertical", "horizontal"]).optional(),
  })
  .strict();

// ── 30. comparison-table ──────────────────────────────────────────────

export const ComparisonRowSchema = z
  .object({
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    values: z
      .array(z.union([z.string().max(500), z.number(), z.null()]))
      .max(20),
    format: z
      .enum(["text", "currency", "percent", "number", "date"])
      .optional(),
    currency: Iso4217Schema.optional(),
    highlight: z.enum(["best", "worst", "none"]).optional(),
  })
  .strict();

export const ComparisonTablePartSchema = z
  .object({
    kind: z.literal("comparison-table"),
    title: z.string().max(200).optional(),
    columns: z.array(z.string().min(1).max(200)).min(2).max(20),
    rows: z.array(ComparisonRowSchema).min(1).max(100),
  })
  .strict();

// ── 31. geo-fence ─────────────────────────────────────────────────────

export const GeoFencePointSchema = z
  .object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
  })
  .strict();

export const GeoFencePartSchema = z
  .object({
    kind: z.literal("geo-fence"),
    title: z.string().max(200).optional(),
    center: z.tuple([
      z.number().gte(-90).lte(90),
      z.number().gte(-180).lte(180),
    ]),
    zoom: z.number().int().min(0).max(20),
    fence: z.array(GeoFencePointSchema).max(200).optional(),
    editable: z.boolean().optional(),
    onChangeAction: z.string().min(1).max(500).optional(),
  })
  .strict();

// ── 32. notification-toast ────────────────────────────────────────────

export const NotificationToastPartSchema = z
  .object({
    kind: z.literal("notification-toast"),
    title: z.string().max(200).optional(),
    message: z.string().min(1).max(1000),
    severity: z.enum(["info", "success", "warning", "error"]),
    autoCloseMs: z.number().int().min(0).max(60_000).optional(),
    actionLabel: z.string().max(60).optional(),
    actionPayload: z.record(z.unknown()).optional(),
  })
  .strict();

// ── 33. decision-trace ────────────────────────────────────────────────

export const DecisionTraceStepSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    rationale: z.string().min(1).max(4000),
    kind: z.enum([
      "observation",
      "inference",
      "tool-call",
      "decision",
      "output",
    ]),
    evidence: z
      .array(
        z
          .object({
            label: z.string().min(1).max(200),
            uri: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
  })
  .strict();

export const DecisionTracePartSchema = z
  .object({
    kind: z.literal("decision-trace"),
    title: z.string().max(200).optional(),
    summary: z.string().max(2000).optional(),
    steps: z.array(DecisionTraceStepSchema).min(1).max(100),
  })
  .strict();

// ── 34. code-block ────────────────────────────────────────────────────

export const CodeBlockPartSchema = z
  .object({
    kind: z.literal("code-block"),
    title: z.string().max(200).optional(),
    code: z.string().min(1).max(50_000),
    language: z.enum([
      "sql",
      "json",
      "log",
      "text",
      "bash",
      "typescript",
      "python",
    ]),
    filename: z.string().max(200).optional(),
    highlightLines: z
      .array(z.number().int().min(1).max(10_000))
      .max(200)
      .optional(),
  })
  .strict();

// ── 35. dataflow-diagram ──────────────────────────────────────────────

export const DataflowNodeSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    kind: z.enum(["source", "transform", "sink", "decision"]),
    status: z.enum(["pending", "running", "done", "failed"]).optional(),
  })
  .strict();

export const DataflowEdgeSchema = z
  .object({
    from: z.string().min(1).max(120),
    to: z.string().min(1).max(120),
    label: z.string().max(120).optional(),
  })
  .strict();

export const DataflowDiagramPartSchema = z
  .object({
    kind: z.literal("dataflow-diagram"),
    title: z.string().max(200).optional(),
    nodes: z.array(DataflowNodeSchema).min(1).max(100),
    edges: z.array(DataflowEdgeSchema).max(300),
  })
  .strict();

export const PART_SCHEMAS = {
  "chart-vega": ChartVegaPartSchema,
  "data-table": DataTablePartSchema,
  timeline: TimelinePartSchema,
  "kpi-grid": KpiGridPartSchema,
  "prefill-form": PrefillFormPartSchema,
  approval: ApprovalPartSchema,
  workflow: WorkflowPartSchema,
  map: MapPartSchema,
  calendar: CalendarPartSchema,
  "file-preview": FilePreviewPartSchema,
  // ProdFix-7 Tier-1
  kanban: KanbanPartSchema,
  "dashboard-grid": DashboardGridPartSchema,
  heatmap: HeatmapPartSchema,
  "markdown-card": MarkdownCardPartSchema,
  "prompt-suggestions": PromptSuggestionsPartSchema,
  "evidence-card": EvidenceCardPartSchema,
  // ProdFix-7 Tier-2
  tree: TreePartSchema,
  "diff-view": DiffViewPartSchema,
  gauge: GaugePartSchema,
  "metric-sparkline": MetricSparklinePartSchema,
  "image-annotation": ImageAnnotationPartSchema,
  "signature-pad": SignaturePadPartSchema,
  // Phase E.7 — 13 new kinds
  "pdf-viewer": PdfViewerPartSchema,
  "slider-input": SliderInputPartSchema,
  "multistep-wizard": MultistepWizardPartSchema,
  "media-grid": MediaGridPartSchema,
  "chat-embed": ChatEmbedPartSchema,
  "live-counter": LiveCounterPartSchema,
  "org-chart": OrgChartPartSchema,
  "comparison-table": ComparisonTablePartSchema,
  "geo-fence": GeoFencePartSchema,
  "notification-toast": NotificationToastPartSchema,
  "decision-trace": DecisionTracePartSchema,
  "code-block": CodeBlockPartSchema,
  "dataflow-diagram": DataflowDiagramPartSchema,
} as const;

export type PartKind = keyof typeof PART_SCHEMAS;
