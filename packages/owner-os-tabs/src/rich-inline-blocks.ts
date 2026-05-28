/**
 * Rich inline UI blocks — INLINE-FIRST flow Layer 2.
 *
 * Wave OWNER-OS-INLINE-FIRST. The Layer 1 catalogue (data_capture_card,
 * confirmation_card, file_request_card, micro_action_card, mini_metric,
 * tab_promotion_chip) covers the small-slice case. Layer 2 here scales
 * the inline slice ALL the way up — full tables, multi-step wizards,
 * charts, comparison cards, and composed mini-dashboards — so that an
 * owner who wants to live entirely in chat can do EVERYTHING there.
 * The full tab becomes a pure escape hatch nobody is forced to use.
 *
 * Schemas:
 *   1. inline_table       — paginated data table
 *   2. inline_chart       — bar / line / sparkline / area / donut
 *   3. inline_wizard      — multi-step form with progress dots
 *   4. inline_workflow    — checklist / runbook with live status
 *   5. inline_comparison  — 2-3 side-by-side option cards
 *   6. inline_section     — collapsible grouping of sub-blocks (recursive)
 *   7. inline_dashboard   — composed mini-dashboard (recursive)
 *
 * Sections and dashboards are recursive — they accept arbitrary inline
 * blocks as children, including more sections / dashboards. The parser
 * cap (8 top-level blocks) still applies; recursion depth is capped at
 * 3 to keep render cost bounded.
 *
 * The combined discriminated union (`inlineBlockSchema`) lives in
 * `inline-blocks.ts` and stitches the Layer 1 + Layer 2 sets together.
 */

import { z } from 'zod';
import { ownerOsTabTypeSchema } from './types.js';

// ─── Shared helpers ─────────────────────────────────────────────────
//
// Rich-block labels can run longer than the Layer 1 labels (table
// column headers, comparison bullets, etc.), so this is its own
// schema. The Layer 1 `BilingualLabel` (max 80) is still the canonical
// type re-exported from inline-blocks.ts; use that for callers that do
// not need the extra length.

const richBilingualLabelSchema = z.object({
  en: z.string().min(1).max(120),
  sw: z.string().min(1).max(120),
});

const toneSchema = z.enum(['positive', 'neutral', 'warning']);
const statusSchema = z.enum(['pending', 'in_progress', 'done', 'blocked']);

const microActionRefSchema = z.object({
  label: richBilingualLabelSchema,
  kind: z.literal('micro_action_card'),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const tabPromotionRefSchema = z.object({
  tabType: ownerOsTabTypeSchema,
  contextTemplate: z.record(z.string(), z.unknown()).default({}),
  label: richBilingualLabelSchema,
});

// ─── 1. inline_table ────────────────────────────────────────────────
//
// Paginated data table inline in the bubble. Row click opens an
// in-chat drawer carrying any inline block as content (recursive).
// FE virtualizes past 50 rows. Default page size = 8.

const TABLE_COLUMN_KINDS = [
  'text',
  'number',
  'date',
  'currency',
  'status_pill',
  'action',
] as const;

const inlineTableColumnSchema = z.object({
  key: z.string().min(1).max(40),
  label: richBilingualLabelSchema,
  kind: z.enum(TABLE_COLUMN_KINDS),
});

const inlineTableRowSchema = z
  .object({
    id: z.string().min(1).max(120),
  })
  .catchall(z.unknown());

const inlineRowActionSchema = z.object({
  kind: z.enum(['inline_drawer', 'micro_action_card', 'data_capture_card']),
  payloadTemplate: z.record(z.string(), z.unknown()).default({}),
});

export const inlineTableSchema = z.object({
  type: z.literal('inline_table'),
  title: richBilingualLabelSchema,
  columns: z.array(inlineTableColumnSchema).min(1).max(8),
  rows: z.array(inlineTableRowSchema).max(500),
  pageSize: z.number().int().min(1).max(50).default(8),
  emptyState: richBilingualLabelSchema.optional(),
  rowAction: inlineRowActionSchema.optional(),
  tabPromotion: tabPromotionRefSchema.optional(),
});

export type InlineTable = z.infer<typeof inlineTableSchema>;

// ─── 2. inline_chart ────────────────────────────────────────────────
//
// Bar / line / sparkline / area / donut. Multi-series allowed; height
// defaults to 220px so the chart fits comfortably inside the chat
// bubble. Annotations let the brain mark "today" or "filing deadline".

const CHART_KINDS = ['bar', 'line', 'sparkline', 'area', 'donut'] as const;

const chartPointSchema = z.object({
  x: z.union([z.string().min(1).max(40), z.number()]),
  y: z.number(),
});

const chartSeriesSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().min(1).max(40),
  points: z.array(chartPointSchema).min(1).max(120),
});

const chartAnnotationSchema = z.object({
  at: z.union([z.string().min(1).max(40), z.number()]),
  label: richBilingualLabelSchema,
  kind: z.enum(['line', 'marker']),
});

export const inlineChartSchema = z.object({
  type: z.literal('inline_chart'),
  kind: z.enum(CHART_KINDS),
  title: richBilingualLabelSchema,
  series: z.array(chartSeriesSchema).min(1).max(5),
  height: z.number().int().min(80).max(480).default(220),
  annotations: z.array(chartAnnotationSchema).max(6).optional(),
  tabPromotion: tabPromotionRefSchema.optional(),
});

export type InlineChart = z.infer<typeof inlineChartSchema>;

// ─── 3. inline_wizard ───────────────────────────────────────────────
//
// Multi-step form. Each step has 1-N fields (re-uses the
// data_capture_card field kinds). State persists in localStorage
// keyed by `borjie:wizard:<purpose>:<sessionId>` so scrolling does
// not lose progress. On submit the FE posts
// `__wizard_response:{purpose, captured}` as the next chat turn.

const WIZARD_FIELD_KINDS = [
  'text',
  'number',
  'date',
  'select',
  'pml-picker',
  'site-picker',
  'amount-tzs',
] as const;

const wizardFieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: richBilingualLabelSchema,
  kind: z.enum(WIZARD_FIELD_KINDS),
  options: z.array(z.string().min(1).max(60)).max(20).optional(),
  required: z.boolean().default(true),
  placeholder: z.string().min(1).max(120).optional(),
});

const wizardSkipConditionSchema = z.object({
  fieldKey: z.string().min(1).max(40),
  equals: z.union([z.string(), z.number(), z.boolean()]),
});

const wizardStepSchema = z.object({
  id: z.string().min(1).max(40),
  title: richBilingualLabelSchema,
  intro: richBilingualLabelSchema.optional(),
  fields: z.array(wizardFieldSchema).max(8),
  skipIf: wizardSkipConditionSchema.optional(),
});

export const inlineWizardSchema = z.object({
  type: z.literal('inline_wizard'),
  purpose: z.string().min(1).max(120),
  steps: z.array(wizardStepSchema).min(1).max(8),
  submitAction: z.string().min(1).max(80),
  tabPromotion: tabPromotionRefSchema.optional(),
});

export type InlineWizard = z.infer<typeof inlineWizardSchema>;

// ─── 4. inline_workflow ─────────────────────────────────────────────
//
// Checklist / runbook with live status. Each step can carry a
// one-tap action to advance it (micro_action_card payload).

const workflowStepSchema = z.object({
  id: z.string().min(1).max(40),
  label: richBilingualLabelSchema,
  status: statusSchema,
  blockedReason: richBilingualLabelSchema.optional(),
  action: microActionRefSchema.optional(),
});

export const inlineWorkflowSchema = z.object({
  type: z.literal('inline_workflow'),
  title: richBilingualLabelSchema,
  steps: z.array(workflowStepSchema).min(1).max(20),
  tabPromotion: tabPromotionRefSchema.optional(),
});

export type InlineWorkflow = z.infer<typeof inlineWorkflowSchema>;

// ─── 5. inline_comparison ───────────────────────────────────────────
//
// 2-3 side-by-side cards. One can be highlighted as the recommended
// option. Each has its own "Choose" micro-action.

const comparisonMetricSchema = z.object({
  label: richBilingualLabelSchema,
  value: z.string().min(1).max(60),
  tone: toneSchema,
});

const comparisonOptionSchema = z.object({
  id: z.string().min(1).max(40),
  headline: richBilingualLabelSchema,
  bullets: z.array(richBilingualLabelSchema).min(1).max(6),
  metrics: z.array(comparisonMetricSchema).max(4),
  recommendedReason: richBilingualLabelSchema.optional(),
  chooseAction: microActionRefSchema,
});

export const inlineComparisonSchema = z.object({
  type: z.literal('inline_comparison'),
  title: richBilingualLabelSchema,
  options: z.array(comparisonOptionSchema).min(2).max(3),
  highlightOptionId: z.string().min(1).max(40).optional(),
  tabPromotion: tabPromotionRefSchema.optional(),
});

export type InlineComparison = z.infer<typeof inlineComparisonSchema>;

// ─── 6 + 7. Recursive container blocks ──────────────────────────────
//
// inline_section and inline_dashboard accept arbitrary inline blocks
// as children. They are recursive — a dashboard can contain a section
// that contains another dashboard. Render depth is capped at 3 (FE
// enforces). We use `z.lazy()` for the self-reference and accept
// `z.unknown()` for the child slot because the full discriminated
// union is defined in `inline-blocks.ts` (which imports this module).

const DASHBOARD_LAYOUTS = [
  'grid_2x2',
  'grid_3x2',
  'strip_horizontal',
] as const;

/**
 * Placeholder child schema. The real validation happens in the
 * combined discriminated union — this schema only enforces that the
 * child has a string `type` field, so unknown / future block types do
 * not crash parsing. The FE renderer narrows by `type` at render time.
 */
const childBlockSchema = z
  .object({ type: z.string().min(1).max(40) })
  .catchall(z.unknown());

export const inlineSectionSchema = z.object({
  type: z.literal('inline_section'),
  title: richBilingualLabelSchema,
  defaultOpen: z.boolean().default(true),
  blocks: z.array(childBlockSchema).min(1).max(8),
});

export type InlineSection = z.infer<typeof inlineSectionSchema>;

export const inlineDashboardSchema = z.object({
  type: z.literal('inline_dashboard'),
  title: richBilingualLabelSchema,
  layout: z.enum(DASHBOARD_LAYOUTS),
  cells: z.array(childBlockSchema).min(1).max(8),
  refreshIntervalSeconds: z.number().int().min(10).max(3600).optional(),
  tabPromotion: tabPromotionRefSchema.optional(),
});

export type InlineDashboard = z.infer<typeof inlineDashboardSchema>;

// ─── Rich block union ───────────────────────────────────────────────

export const richInlineBlockSchema = z.discriminatedUnion('type', [
  inlineTableSchema,
  inlineChartSchema,
  inlineWizardSchema,
  inlineWorkflowSchema,
  inlineComparisonSchema,
  inlineSectionSchema,
  inlineDashboardSchema,
]);

export type RichInlineBlock = z.infer<typeof richInlineBlockSchema>;

export const RICH_INLINE_BLOCK_TYPES: ReadonlyArray<RichInlineBlock['type']> = [
  'inline_table',
  'inline_chart',
  'inline_wizard',
  'inline_workflow',
  'inline_comparison',
  'inline_section',
  'inline_dashboard',
];
