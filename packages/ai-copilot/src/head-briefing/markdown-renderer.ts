/**
 * Markdown renderer for the head-briefing document.
 *
 * Produces a readable, transport-free markdown string the UI can drop
 * into a chat bubble, a PDF export, or an email. Structure mirrors the
 * document's six sections so a reader scanning top-to-bottom always
 * lands on the most important information first.
 */

import type {
  BriefingAnomaly,
  BriefingDocument,
  BriefingRecommendation,
  EscalationsSection,
  KpiDelta,
  KpiDelta30d,
  KpiDeltasSection,
  OvernightSection,
  PendingApprovalsSection,
} from './types.js';

export function renderMarkdown(doc: BriefingDocument): string {
  const lines: string[] = [];
  lines.push('# Morning briefing');
  lines.push('');
  lines.push(`_Generated ${doc.generatedAt}_`);
  lines.push('');
  lines.push(`**${doc.headline}**`);
  lines.push('');

  renderOvernight(lines, doc.overnight);
  renderPendingApprovals(lines, doc.pendingApprovals);
  renderEscalations(lines, doc.escalations);
  renderKpiDeltas(lines, doc.kpiDeltas);
  renderRecommendations(lines, doc.recommendations);
  renderAnomalies(lines, doc.anomalies);

  return lines.join('\n');
}

function renderOvernight(lines: string[], section: OvernightSection): void {
  lines.push('## Overnight — what I handled');
  lines.push('');
  if (section.totalAutonomousActions === 0) {
    lines.push('_No autonomous activity in the window._');
    lines.push('');
    return;
  }
  lines.push(
    `- Total autonomous actions: **${section.totalAutonomousActions}**`,
  );
  const byDomainEntries = Object.entries(section.byDomain);
  if (byDomainEntries.length > 0) {
    lines.push('- By domain:');
    for (const [domain, count] of byDomainEntries) {
      lines.push(`  - ${domain}: ${count}`);
    }
  }
  if (section.notableActions.length > 0) {
    lines.push('- Notable actions:');
    for (const a of section.notableActions) {
      lines.push(
        `  - [${a.domain}] ${a.summary} _(confidence ${(
          a.confidence * 100
        ).toFixed(0)}%)_`,
      );
    }
  }
  lines.push('');
}

function renderPendingApprovals(
  lines: string[],
  section: PendingApprovalsSection,
): void {
  lines.push('## Pending approvals — what needs you');
  lines.push('');
  if (section.count === 0) {
    lines.push('_Nothing waiting on your sign-off._');
    lines.push('');
    return;
  }
  lines.push(`- ${section.count} item(s) awaiting your decision:`);
  for (const item of section.items) {
    lines.push(
      `  - [${item.urgency.toUpperCase()}] (${item.kind}) ${item.summary}`,
    );
  }
  lines.push('');
}

function renderEscalations(
  lines: string[],
  section: EscalationsSection,
): void {
  lines.push('## Escalations — what I surfaced');
  lines.push('');
  if (section.count === 0) {
    lines.push('_No open escalations._');
    lines.push('');
    return;
  }
  lines.push(
    `- Open: **${section.count}** (P1: ${section.byPriority.P1}, P2: ${section.byPriority.P2}, P3: ${section.byPriority.P3})`,
  );
  for (const item of section.items) {
    lines.push(`  - [${item.priority}] [${item.domain}] ${item.summary}`);
  }
  lines.push('');
}

function renderKpiDeltas(
  lines: string[],
  section: KpiDeltasSection,
): void {
  lines.push('## KPI deltas — how we are trending');
  lines.push('');
  lines.push('| Metric | Current | Delta |');
  lines.push('|---|---|---|');
  lines.push(row('Occupancy %', section.occupancyPct));
  lines.push(row('Collections %', section.collectionsRate));
  lines.push(row('Arrears (days)', section.arrearsDays));
  lines.push(row('Maintenance SLA %', section.maintenanceSLA));
  lines.push(row30d('Tenant satisfaction', section.tenantSatisfaction));
  lines.push(row30d('NOI', section.noi));
  lines.push('');
}

function row(label: string, kpi: KpiDelta): string {
  return `| ${label} | ${formatNumber(kpi.value)} | ${formatDelta(
    kpi.delta7d,
  )} (7d) |`;
}

function row30d(label: string, kpi: KpiDelta30d): string {
  return `| ${label} | ${formatNumber(kpi.value)} | ${formatDelta(
    kpi.delta30d,
  )} (30d) |`;
}

function renderRecommendations(
  lines: string[],
  recs: readonly BriefingRecommendation[],
): void {
  lines.push('## Recommendations — what I would do next');
  lines.push('');
  if (recs.length === 0) {
    lines.push('_No active recommendations — portfolio trending cleanly._');
    lines.push('');
    return;
  }
  for (const r of recs) {
    lines.push(`### ${r.topic}`);
    lines.push('');
    lines.push(r.summary);
    lines.push('');
    lines.push(`- **Rationale:** ${r.rationale}`);
    lines.push(
      `- **Confidence:** ${(r.confidence * 100).toFixed(0)}%`,
    );
    lines.push(`- **Suggested action:** ${r.suggestedAction}`);
    lines.push('');
  }
}

function renderAnomalies(
  lines: string[],
  anomalies: readonly BriefingAnomaly[],
): void {
  lines.push('## Anomalies — what seems off');
  lines.push('');
  if (anomalies.length === 0) {
    lines.push('_Nothing anomalous in the last cycle._');
    lines.push('');
    return;
  }
  for (const a of anomalies) {
    lines.push(`- **${a.area}:** ${a.observation}`);
    lines.push(`  - _Possible cause:_ ${a.possibleCause}`);
    lines.push(`  - _Suggested investigation:_ ${a.suggestedInvestigation}`);
  }
  lines.push('');
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function formatDelta(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n)}`;
}
