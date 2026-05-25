/**
 * HTML template for strategic reports — used by the Puppeteer HTML→PDF
 * renderer in `@borjie/document-studio` and as the basis for the
 * PPTX-like slide rendering. Pure function, no DOM dependency.
 */

import type { StrategicReport } from '../types.js';

const HTML_SAFE = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildHtmlSource(report: StrategicReport): string {
  const sections = report.sections
    .map((s) => {
      const h = `h${s.heading + 1}` as 'h2' | 'h3' | 'h4';
      const body = s.evidenceUnavailable
        ? '<p class="evidence-unavailable"><em>Evidence unavailable &mdash; see appendix.</em></p>'
        : `<div class="section-body">${HTML_SAFE(s.body)}</div>`;
      const tables = s.tables.map(renderHtmlTable).join('');
      return `<section class="report-section" id="sec-${HTML_SAFE(s.id)}">
        <${h}>${HTML_SAFE(s.title)}</${h}>
        ${body}
        ${tables}
      </section>`;
    })
    .join('');

  const actionRows = report.actionPlan
    .map(
      (a) =>
        `<tr><td>${HTML_SAFE(a.priority.toUpperCase())}</td><td>${HTML_SAFE(a.title)}</td><td>${HTML_SAFE(a.owner)}</td><td>${HTML_SAFE(a.dueDateIso)}</td><td>${HTML_SAFE(a.successCriterion)}</td></tr>`,
    )
    .join('');
  const citationItems = report.citations
    .map(
      (c) =>
        `<li><strong>[${HTML_SAFE(c.id)}]</strong> ${HTML_SAFE(c.claim)} <span class="source">${HTML_SAFE(c.source.kind)}/${HTML_SAFE(c.source.ref)}</span></li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${HTML_SAFE(report.title)}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 920px; margin: 0 auto; padding: 32px; color: #1a1a1a; }
    h1 { font-family: 'Inter', system-ui, sans-serif; font-size: 28px; margin-bottom: 4px; }
    h2 { font-family: 'Inter', system-ui, sans-serif; margin-top: 24px; }
    .subtitle { color: #555; font-size: 12px; }
    .executive-summary { background: #f6f7fb; padding: 12px 16px; border-left: 3px solid #2860c4; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; font-family: 'Inter', system-ui, sans-serif; font-size: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f0f2f8; }
    .action-plan th { background: #efe3c4; }
    .citation-list { font-size: 11px; }
    .citation-list .source { color: #555; }
    .evidence-unavailable { color: #b00020; }
  </style>
</head>
<body>
  <h1>${HTML_SAFE(report.title)}</h1>
  <div class="subtitle">${HTML_SAFE(report.spec.audience)} &middot; ${HTML_SAFE(report.spec.depth)} &middot; ${HTML_SAFE(report.spec.jurisdiction)} &middot; ${HTML_SAFE(report.spec.period.periodStart)} &mdash; ${HTML_SAFE(report.spec.period.periodEnd)}</div>
  <div class="executive-summary">${HTML_SAFE(report.executiveSummary)}</div>
  ${sections}
  <h2>Action plan</h2>
  <table class="action-plan">
    <thead><tr><th>Priority</th><th>Title</th><th>Owner</th><th>Due</th><th>Success criterion</th></tr></thead>
    <tbody>${actionRows}</tbody>
  </table>
  <h2>Citations</h2>
  <ol class="citation-list">${citationItems}</ol>
</body>
</html>`;
}

function renderHtmlTable(table: StrategicReport['tables'][number]): string {
  if (table.rows.length === 0) return '';
  const headers = table.headers.map((h) => `<th>${HTML_SAFE(h)}</th>`).join('');
  const rows = table.rows
    .map((row) => `<tr>${row.map((c) => `<td>${HTML_SAFE(String(c))}</td>`).join('')}</tr>`)
    .join('');
  const total = table.totalRow
    ? `<tr class="total-row">${table.totalRow.map((c) => `<td><strong>${HTML_SAFE(String(c))}</strong></td>`).join('')}</tr>`
    : '';
  return `<figure class="report-table"><figcaption>${HTML_SAFE(table.title)}</figcaption><table><thead><tr>${headers}</tr></thead><tbody>${rows}${total}</tbody></table></figure>`;
}
