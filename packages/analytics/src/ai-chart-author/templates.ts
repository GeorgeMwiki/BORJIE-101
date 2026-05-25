/**
 * Deterministic chart-spec templates.
 *
 * These are the fallback path when no LLM is available — and the SOTA
 * "Hex Magic" / "Tableau Pulse" / "ThoughtSpot Sage" pattern is to
 * always anchor LLM output against a known-good template so it cannot
 * hallucinate fields the renderer can't draw. We pick the template
 * from a simple keyword heuristic over the question.
 */

import type { ChartMarkType, NLQueryRequest, NLQueryResponse, SchemaProfile } from '../types.js';
import {
  barChart,
  boxplotChart,
  heatmapChart,
  lineChart,
  pieChart,
  scatterChart,
} from '../charts/builders.js';

interface TemplatePick {
  readonly kind: ChartMarkType;
  readonly x?: string;
  readonly y?: string;
  readonly category?: string;
  readonly value?: string;
}

export function pickTemplate(question: string, schema: SchemaProfile, preferred?: ChartMarkType): TemplatePick {
  const q = question.toLowerCase();
  const numericCols = schema.columns.filter((c) => c.inferredType === 'integer' || c.inferredType === 'number').map((c) => c.name);
  const categoryCols = schema.columns.filter((c) => c.inferredType === 'string').map((c) => c.name);
  const timeCols = schema.columns.filter((c) => c.inferredType === 'timestamp' || c.inferredType === 'date').map((c) => c.name);

  // Preferred wins if the schema can support it.
  if (preferred === 'line' && timeCols[0] && numericCols[0]) {
    return { kind: 'line', x: timeCols[0], y: numericCols[0] };
  }
  if (preferred === 'bar' && categoryCols[0] && numericCols[0]) {
    return { kind: 'bar', x: categoryCols[0], y: numericCols[0] };
  }

  // Question heuristics — match SOTA Tableau Pulse / Sage routing.
  if ((q.includes('trend') || q.includes('over time') || q.includes('weekly') || q.includes('monthly') || q.includes('daily')) && timeCols[0] && numericCols[0]) {
    return { kind: 'line', x: timeCols[0], y: numericCols[0] };
  }
  if ((q.includes('share') || q.includes('breakdown') || q.includes('proportion')) && categoryCols[0] && numericCols[0]) {
    return { kind: 'arc', category: categoryCols[0], value: numericCols[0] };
  }
  if ((q.includes('distribution') || q.includes('spread') || q.includes('range')) && categoryCols[0] && numericCols[0]) {
    return { kind: 'boxplot', category: categoryCols[0], value: numericCols[0] };
  }
  if ((q.includes('correlate') || q.includes('relationship') || q.includes('vs') || q.includes(' versus ')) && numericCols.length >= 2 && numericCols[0] && numericCols[1]) {
    return { kind: 'point', x: numericCols[0], y: numericCols[1] };
  }
  if ((q.includes('heatmap') || q.includes('density') || q.includes('matrix')) && categoryCols.length >= 2 && numericCols[0] && categoryCols[0] && categoryCols[1]) {
    return { kind: 'rect', x: categoryCols[0], y: categoryCols[1], value: numericCols[0] };
  }
  // Default: bar of first category + first numeric.
  if (categoryCols[0] && numericCols[0]) {
    return { kind: 'bar', x: categoryCols[0], y: numericCols[0] };
  }
  // Fallback when the schema is hostile.
  return { kind: 'bar', x: schema.columns[0]?.name ?? 'category', y: schema.columns[1]?.name ?? 'value' };
}

/**
 * Build a deterministic NLQueryResponse from the template pick.
 */
export function deterministicResponse(req: NLQueryRequest, pick: TemplatePick, data: readonly Record<string, unknown>[] = []): NLQueryResponse {
  switch (pick.kind) {
    case 'line':
      return {
        spec: lineChart({ data, x: pick.x ?? 'x', y: pick.y ?? 'y', title: req.question }),
        explanation: `Trend of ${pick.y} over ${pick.x} — chosen because the question mentions time and the schema has both a temporal column and a numeric column.`,
        deterministic: true,
      };
    case 'arc':
      return {
        spec: pieChart({ data, category: pick.category ?? 'cat', value: pick.value ?? 'val', title: req.question }),
        explanation: `Share of ${pick.value} by ${pick.category}.`,
        deterministic: true,
      };
    case 'boxplot':
      return {
        spec: boxplotChart({ data, category: pick.category ?? 'cat', value: pick.value ?? 'val', title: req.question }),
        explanation: `Distribution of ${pick.value} per ${pick.category}.`,
        deterministic: true,
      };
    case 'point':
      return {
        spec: scatterChart({ data, x: pick.x ?? 'x', y: pick.y ?? 'y', title: req.question }),
        explanation: `Relationship between ${pick.x} and ${pick.y}.`,
        deterministic: true,
      };
    case 'rect':
      return {
        spec: heatmapChart({ data, x: pick.x ?? 'x', y: pick.y ?? 'y', value: pick.value ?? 'val', title: req.question }),
        explanation: `Density of ${pick.value} across ${pick.x} and ${pick.y}.`,
        deterministic: true,
      };
    case 'bar':
    default:
      return {
        spec: barChart({ data, x: pick.x ?? 'x', y: pick.y ?? 'y', title: req.question }),
        explanation: `${pick.y} by ${pick.x}.`,
        deterministic: true,
      };
  }
}
