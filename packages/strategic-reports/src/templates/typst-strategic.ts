/**
 * Typst template builder for strategic reports (PDF).
 *
 * Produces a `*.typ` source string the `@borjie/document-studio`
 * Typst renderer compiles to a PDF. Layout matches the existing
 * monthly-owner-report Typst convention (sans-serif headings,
 * serif body, citation footnotes, action-plan table in a tinted box).
 *
 * Pure function — no I/O. The renderer in document-studio receives
 * the string + the StrategicReport's binary inputs (chart SVG) and
 * spawns the Typst CLI to produce the bytes.
 */

import type { StrategicReport } from '../types.js';

export function buildTypstSource(report: StrategicReport): string {
  const meta = report.spec;
  const title = report.title;
  const subtitle = `${meta.audience.toUpperCase()} · ${meta.depth.toUpperCase()} · ${meta.jurisdiction}`;
  const period = `${meta.period.periodStart} → ${meta.period.periodEnd}`;

  const sectionTyp = report.sections
    .map((s) => {
      const heading = s.heading === 1 ? '=' : s.heading === 2 ? '==' : '===';
      const body = s.evidenceUnavailable
        ? '#emph[Evidence unavailable — see appendix.]'
        : escapeTyp(s.body);
      const tableBlock = s.tables.map(renderTableTyp).join('\n');
      return `${heading} ${escapeTyp(s.title)}\n\n${body}\n\n${tableBlock}`;
    })
    .join('\n\n');

  const actionPlanTyp = renderActionPlanTyp(report);
  const citationsTyp = renderCitationsTyp(report);

  return `#set page(paper: "a4", margin: 1.4cm)
#set text(font: "New Computer Modern", size: 10pt)
#set heading(numbering: "1.")

#align(center)[
  #text(weight: "bold", size: 18pt)[${escapeTyp(title)}]
  \\
  #text(size: 9pt, fill: gray)[${escapeTyp(subtitle)} · ${escapeTyp(period)}]
]

#v(0.5cm)

== Executive summary
${escapeTyp(report.executiveSummary)}

${sectionTyp}

== Action plan
${actionPlanTyp}

== Citations
${citationsTyp}
`;
}

function escapeTyp(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/#/g, '\\#').replace(/\$/g, '\\$');
}

function renderTableTyp(table: StrategicReport['tables'][number]): string {
  if (table.rows.length === 0) return '';
  const headerRow = `[*${table.headers.map(escapeTyp).join('*], [*')}*]`;
  const dataRows = table.rows
    .map((row) => `[${row.map((c) => escapeTyp(String(c))).join('], [')}]`)
    .join(',\n  ');
  const totalRow = table.totalRow
    ? `,\n  [${table.totalRow.map((c) => `*${escapeTyp(String(c))}*`).join('], [')}]`
    : '';
  return `#figure(table(columns: ${table.headers.length},\n  ${headerRow},\n  ${dataRows}${totalRow}\n), caption: [${escapeTyp(table.title)}])`;
}

function renderActionPlanTyp(report: StrategicReport): string {
  if (report.actionPlan.length === 0) return '_No action items._';
  const rows = report.actionPlan
    .map(
      (item) =>
        `[${escapeTyp(item.priority.toUpperCase())}], [${escapeTyp(item.title)}], [${escapeTyp(item.owner)}], [${escapeTyp(item.dueDateIso)}], [${escapeTyp(item.successCriterion)}]`,
    )
    .join(',\n  ');
  return `#table(columns: 5,\n  [*Priority*], [*Title*], [*Owner*], [*Due*], [*Success criterion*],\n  ${rows}\n)`;
}

function renderCitationsTyp(report: StrategicReport): string {
  if (report.citations.length === 0) return '_No citations._';
  return report.citations
    .map((c) => `- *[${escapeTyp(c.id)}]* ${escapeTyp(c.claim)} — ${escapeTyp(c.source.kind)}/${escapeTyp(c.source.ref)}`)
    .join('\n');
}
