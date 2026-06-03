/**
 * Model-card renderer — pure (record) → Markdown (LP-22b).
 *
 * Renders a {@link ModelCardRecord} to a Markdown document whose section
 * order follows Mitchell et al. 2019 ("Model Cards for Model Reporting"):
 *
 *   1. Model details        6. Training data
 *   2. Intended use         7. Ethical considerations
 *   3. Factors (features)    8. Caveats & recommendations
 *   4. Metrics
 *   5. Evaluation data (fairness slices, four-fifths gate)
 *
 * The function is deterministic and I/O-free — given the same record it
 * produces byte-identical output (no `Date.now()`, no env reads), so it is
 * safe to snapshot-test and to diff in CI. Callers that need a generated-at
 * stamp pass it in via `generatedAt`.
 *
 * @module model-card/renderer
 */

import {
  modelCardRecordSchema,
  type ModelCardFairnessSlice,
  type ModelCardFeature,
  type ModelCardMetric,
  type ModelCardRecord,
  type RenderedModelCard,
} from './types.js';

/** Escape a value for safe inclusion in a Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** Format a metric value with sensible precision. */
function fmt(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) !== 0 && Math.abs(value) < 0.001) {
    return value.toExponential(3);
  }
  return value.toFixed(4);
}

function modelDetails(r: ModelCardRecord): string {
  return [
    '## 1. Model details',
    '',
    `- **Model ID:** \`${r.id}\``,
    `- **Name:** ${cell(r.name)}`,
    `- **Version:** ${cell(r.version)}`,
    `- **Status:** \`${r.status}\``,
    `- **Owner:** ${cell(r.owner)}`,
    `- **Trained at:** ${cell(r.trainedAt)}`,
    `- **Train dataset hash:** \`${r.trainDatasetHash}\``,
  ].join('\n');
}

function intendedUse(r: ModelCardRecord): string {
  const lines = ['## 2. Intended use', '', r.intendedUse];
  if (r.outOfScopeUses.length > 0) {
    lines.push('', '**Out-of-scope uses:**', '');
    for (const u of r.outOfScopeUses) lines.push(`- ${cell(u)}`);
  }
  return lines.join('\n');
}

function factors(features: ReadonlyArray<ModelCardFeature>): string {
  if (features.length === 0) {
    return ['## 3. Factors (features)', '', '_No features declared._'].join(
      '\n',
    );
  }
  const rows = features
    .map(
      (f) =>
        `| ${cell(f.name)} | ${f.type} | ${cell(f.source)} | ${
          f.nullable ? 'yes' : 'no'
        } | ${f.sensitive ? 'yes' : 'no'} |`,
    )
    .join('\n');
  return [
    '## 3. Factors (features)',
    '',
    '| Name | Type | Source | Nullable | Sensitive |',
    '|------|------|--------|----------|-----------|',
    rows,
  ].join('\n');
}

function metricsSection(metrics: ReadonlyArray<ModelCardMetric>): string {
  if (metrics.length === 0) {
    return ['## 4. Metrics', '', '_No metrics reported._'].join('\n');
  }
  const rows = metrics
    .map(
      (m) =>
        `| ${cell(m.key)} | ${fmt(m.value)} | ${cell(m.unit ?? '')} | ${
          m.higherIsBetter ? 'higher' : 'lower'
        } |`,
    )
    .join('\n');
  return [
    '## 4. Metrics',
    '',
    '| Metric | Value | Unit | Better |',
    '|--------|-------|------|--------|',
    rows,
  ].join('\n');
}

/** Returns `{ markdown, failing }` for the fairness section. */
function fairnessSection(
  slices: ReadonlyArray<ModelCardFairnessSlice>,
  floor: number,
): { markdown: string; failing: ModelCardFairnessSlice[] } {
  if (slices.length === 0) {
    return {
      markdown: [
        '## 5. Evaluation data — fairness slices',
        '',
        '_No disaggregated slices reported._',
      ].join('\n'),
      failing: [],
    };
  }
  const failing: ModelCardFairnessSlice[] = [];
  const rows = slices
    .map((s) => {
      const pass = s.disparityRatio >= floor;
      if (!pass) failing.push(s);
      return `| ${cell(s.attribute)} | ${cell(s.slice)} | ${fmt(
        s.metricValue,
      )} | ${s.population.toLocaleString('en-US')} | ${fmt(
        s.disparityRatio,
      )} | ${pass ? 'PASS' : 'FAIL'} |`;
    })
    .join('\n');
  const markdown = [
    '## 5. Evaluation data — fairness slices',
    '',
    `Disparity gate (four-fifths analog): a slice passes when its ratio to the`,
    `best slice for the same attribute is ≥ ${floor.toFixed(2)}.`,
    '',
    '| Attribute | Slice | Metric | Population | Disparity ratio | Status |',
    '|-----------|-------|--------|------------|-----------------|--------|',
    rows,
  ].join('\n');
  return { markdown, failing };
}

function trainingData(r: ModelCardRecord): string {
  return [
    '## 6. Training data',
    '',
    r.trainingDataSummary,
    '',
    `- **Sample size:** ${r.trainingSampleSize.toLocaleString('en-US')}`,
    `- **Snapshot hash:** \`${r.trainDatasetHash}\``,
  ].join('\n');
}

function ethical(r: ModelCardRecord): string {
  const lines = ['## 7. Ethical considerations', ''];
  if (r.ethicalConsiderations.length === 0) {
    lines.push('_None recorded._');
  } else {
    for (const e of r.ethicalConsiderations) lines.push(`- ${cell(e)}`);
  }
  return lines.join('\n');
}

function caveats(r: ModelCardRecord): string {
  const lines = ['## 8. Caveats & recommendations', ''];
  if (r.caveats.length === 0) {
    lines.push('_None recorded._');
  } else {
    for (const c of r.caveats) lines.push(`- ${cell(c)}`);
  }
  if (r.notes) lines.push('', `_Owner notes:_ ${cell(r.notes)}`);
  return lines.join('\n');
}

export interface RenderModelCardOptions {
  /** Optional ISO timestamp rendered in the footer. Omit for deterministic output. */
  readonly generatedAt?: string;
}

/**
 * Render a validated model card to Markdown.
 *
 * Pass a parsed record (use {@link renderModelCardFromUnknown} to validate
 * untrusted input first). Returns the Markdown plus a machine-checkable
 * fairness verdict so a CI gate can fail a deploy on a sub-floor slice.
 */
export function renderModelCard(
  record: ModelCardRecord,
  opts: RenderModelCardOptions = {},
): RenderedModelCard {
  const header = [
    `# Model card — ${cell(record.name)} v${cell(record.version)}`,
    '',
    '> Mitchell et al. 2019 section structure. Outputs are advisory; the',
    '> rule-based decision and human review remain authoritative (predictions',
    '> APPEND, never replace).',
  ].join('\n');

  const fairness = fairnessSection(record.fairnessSlices, record.fairnessFloor);

  const footerParts = ['---', '_Rendered by @borjie/observability model-card renderer_'];
  if (opts.generatedAt) footerParts.push(`_(generated ${cell(opts.generatedAt)})_`);
  const footer = footerParts.join(' ');

  const markdown =
    [
      header,
      modelDetails(record),
      intendedUse(record),
      factors(record.features),
      metricsSection(record.metrics),
      fairness.markdown,
      trainingData(record),
      ethical(record),
      caveats(record),
      footer,
    ].join('\n\n') + '\n';

  return {
    markdown,
    fairnessPasses: fairness.failing.length === 0,
    failingSlices: fairness.failing,
  };
}

/**
 * Validate untrusted input then render. Throws a zod error if the record is
 * malformed — callers in a CI gate should let that propagate (fail closed).
 */
export function renderModelCardFromUnknown(
  input: unknown,
  opts: RenderModelCardOptions = {},
): RenderedModelCard {
  const record = modelCardRecordSchema.parse(input);
  return renderModelCard(record, opts);
}
