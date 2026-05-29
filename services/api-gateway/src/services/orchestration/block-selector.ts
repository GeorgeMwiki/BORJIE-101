/**
 * Block Selector — CE-6.
 *
 * Pure function mapping a result-shape to the recommended inline
 * block kind the brain should emit. Closes the "brain picks the
 * right block per result type" gap identified by the SOTA audit:
 *
 *   - Tabular result → `<inline_table>`
 *   - Ranked / scored list → `<inline_comparison>`
 *   - Time-series → `<inline_chart>`
 *   - Single fact / KPI → `<mini_metric>`
 *   - Draft-shaped text → `<draft_preview>`
 *   - Destructive action → `<confirmation_card>`
 *   - Multi-step gather → `<inline_wizard>`
 *   - Document-quest navigator → `<doc_quest>`
 *   - Otherwise prose → no block
 *
 * The selector inspects the result shape via structural heuristics
 * (key names, array shape, value types) without parsing semantic
 * intent — that's the brain's job; this is the rendering hint layer.
 *
 * Frontier reference: Manus AI auto-selects block kind from result
 * schema (`Docs/research/CHAT_HANDLES_EVERYTHING_SOTA_2026-05-29.md`
 * §3). This is Borjie's analogue.
 *
 * Discipline:
 *   - Pure function. No I/O.
 *   - Functions <50 lines, nesting <4.
 *   - 19 inline blocks supported; default is 'none' (prose only).
 */

import { z } from 'zod';

export const inlineBlockKindSchema = z.enum([
  'citations',
  'confirmation_card',
  'data_capture_card',
  'doc_quest',
  'draft_edit',
  'draft_preview',
  'file_request_card',
  'inline_chart',
  'inline_comparison',
  'inline_dashboard',
  'inline_section',
  'inline_table',
  'inline_wizard',
  'inline_workflow',
  'level_select',
  'micro_action_card',
  'mini_metric',
  'plan_preview',
  'tab_promotion_chip',
  'none',
]);
export type InlineBlockKind = z.infer<typeof inlineBlockKindSchema>;

export interface BlockHintContext {
  /**
   * Action stakes from the brain-tool descriptor. Used to bias
   * toward `confirmation_card` for HIGH-stakes results.
   */
  readonly stakes?: 'LOW' | 'MEDIUM' | 'HIGH';
  /**
   * True iff the result represents a multi-step plan (the runner
   * produces these). Forces `plan_preview` when set.
   */
  readonly isPlan?: boolean;
  /**
   * Optional hint the brain may set explicitly to override
   * structural inference (escape hatch).
   */
  readonly forceKind?: InlineBlockKind;
}

const TABLE_HINT_KEYS = new Set(['rows', 'records', 'items', 'list']);
const CHART_HINT_KEYS = new Set([
  'series',
  'datapoints',
  'timeseries',
  'points',
]);
const COMPARISON_HINT_KEYS = new Set([
  'ranked',
  'top',
  'comparison',
  'leaderboard',
  'options',
]);
const DRAFT_HINT_KEYS = new Set([
  'draft',
  'draft_text',
  'draftBody',
  'documentDraft',
]);
const METRIC_HINT_KEYS = new Set([
  'value',
  'amount',
  'count',
  'total',
  'metric',
]);

/**
 * Choose the inline block kind for a result. The selector inspects
 * the `result` object's shape using structural heuristics anchored
 * to the keys above.
 *
 * Order of checks (highest priority first):
 *   1. Explicit override (`ctx.forceKind`) — always wins.
 *   2. Plan-DAG snapshot → `plan_preview`.
 *   3. HIGH-stakes WRITE → `confirmation_card`.
 *   4. Structural heuristics by key shape.
 *   5. Default `none`.
 */
export function selectInlineBlock(
  result: unknown,
  ctx?: BlockHintContext,
): InlineBlockKind {
  if (ctx?.forceKind) return ctx.forceKind;
  if (ctx?.isPlan) return 'plan_preview';
  if (ctx?.stakes === 'HIGH') return 'confirmation_card';
  if (result === null || typeof result !== 'object') {
    return 'none';
  }
  const obj = result as Record<string, unknown>;
  const kind = inferFromShape(obj);
  return kind ?? 'none';
}

function inferFromShape(obj: Record<string, unknown>): InlineBlockKind | null {
  const draft = pickKey(obj, DRAFT_HINT_KEYS);
  if (draft && typeof draft === 'string') return 'draft_preview';

  const chart = pickKey(obj, CHART_HINT_KEYS);
  if (Array.isArray(chart) && chart.length > 0 && isPointArray(chart)) {
    return 'inline_chart';
  }

  const comparison = pickKey(obj, COMPARISON_HINT_KEYS);
  if (Array.isArray(comparison) && comparison.length > 0) {
    return 'inline_comparison';
  }

  const table = pickKey(obj, TABLE_HINT_KEYS);
  if (Array.isArray(table) && table.length > 0 && isRowArray(table)) {
    return 'inline_table';
  }

  const metric = pickKey(obj, METRIC_HINT_KEYS);
  if (metric !== undefined && (typeof metric === 'number' || typeof metric === 'string')) {
    return 'mini_metric';
  }

  return null;
}

function pickKey(
  obj: Record<string, unknown>,
  keys: ReadonlySet<string>,
): unknown {
  for (const key of Object.keys(obj)) {
    if (keys.has(key)) return obj[key];
  }
  return undefined;
}

function isRowArray(arr: ReadonlyArray<unknown>): boolean {
  // A row is an object with at least 2 keys.
  const first = arr[0];
  if (first === null || typeof first !== 'object') return false;
  return Object.keys(first as Record<string, unknown>).length >= 2;
}

function isPointArray(arr: ReadonlyArray<unknown>): boolean {
  // A chart point is an object with at least a numeric value field
  // and one dimension (x / t / date / label).
  const first = arr[0];
  if (first === null || typeof first !== 'object') return false;
  const keys = Object.keys(first as Record<string, unknown>);
  const hasDim = keys.some((k) => /^(x|t|date|label|name|period)$/i.test(k));
  const hasMetric = keys.some((k) =>
    /^(y|value|amount|count|total|metric)$/i.test(k),
  );
  return hasDim && hasMetric;
}
