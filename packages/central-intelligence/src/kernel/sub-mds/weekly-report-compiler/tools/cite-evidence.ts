/**
 * `report.cite_evidence` — read tier.
 *
 * Builds Citations API entries from KPI/anomaly outputs so every claim
 * in the rendered briefing links back to its source row.
 *
 * Citation shape mirrors the Citations API the design-system renders;
 * it's structurally simple (id + source + label + url) and serialises
 * 1:1 to the genui `citation-card` UI kind.
 */

import type { PortfolioKpiSnapshot } from './gather-kpis.js';
import type { Anomaly } from './detect-anomalies.js';

export interface Citation {
  readonly id: string;
  readonly metric: string;
  readonly sourceTable: string;
  readonly sourceRowId: string;
  readonly label: string;
  readonly capturedAtMs: number;
}

export interface CiteEvidenceArgs {
  readonly snapshot: PortfolioKpiSnapshot;
  readonly anomalies: ReadonlyArray<Anomaly>;
}

export interface CiteEvidenceResult {
  readonly citations: ReadonlyArray<Citation>;
  readonly byMetric: Readonly<Record<string, string>>;
}

export function citeEvidence(args: CiteEvidenceArgs): CiteEvidenceResult {
  const s = args.snapshot;
  const items: Citation[] = [
    citation('cashflow.gross', 'cashflow', s.cashflow.citation, 'gross collected this week'),
    citation('cashflow.net', 'cashflow', s.cashflow.citation, 'net collected this week'),
    citation('cashflow.arrears', 'cashflow', s.cashflow.citation, 'open arrears balance'),
    citation('occupancy.rate', 'occupancy', s.occupancy.citation, 'occupancy rate'),
    citation('occupancy.signs', 'occupancy', s.occupancy.citation, 'new lease signs this week'),
    citation('arrears.newThisWeek', 'arrears', s.arrears.citation, 'new arrears cases this week'),
    citation('maintenance.openTickets', 'maintenance', s.maintenance.citation, 'open tickets'),
    citation('maintenance.emergency', 'maintenance', s.maintenance.citation, 'emergency tickets this week'),
    citation('complaints.new', 'complaints', s.complaints.citation, 'new complaints this week'),
    citation('complaints.critical', 'complaints', s.complaints.citation, 'critical complaints this week'),
  ];
  // Anomaly-derived citations
  args.anomalies.forEach((a, i) => {
    items.push({
      id: `anomaly.${i + 1}`,
      metric: a.metric,
      sourceTable: 'forecast-replay',
      sourceRowId: `${a.metric}@${s.periodStartMs}-${s.periodEndMs}`,
      label: `${a.metric} delta ${a.relativeError * 100}%`,
      capturedAtMs: Math.floor(s.periodEndMs),
    });
  });
  // byMetric maps citation `id` (e.g. "cashflow.gross") → its metric
  // family ("cashflow"). Keyed by id so per-row citations are uniquely
  // addressable, since multiple citations can share a metric family.
  const byMetric: Record<string, string> = {};
  for (const c of items) byMetric[c.id] = c.metric;
  return Object.freeze({
    citations: Object.freeze(items),
    byMetric: Object.freeze(byMetric),
  });
}

function citation(
  id: string,
  metric: string,
  cit: { readonly sourceTable: string; readonly sourceRowId: string; readonly capturedAtMs: number },
  label: string,
): Citation {
  return Object.freeze({
    id,
    metric,
    sourceTable: cit.sourceTable,
    sourceRowId: cit.sourceRowId,
    label,
    capturedAtMs: cit.capturedAtMs,
  });
}
