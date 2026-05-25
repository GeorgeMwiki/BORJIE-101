/**
 * Leasing financial performance gatherer.
 *
 * Pulls revenue + occupancy trends from the leasing-financial port and
 * shapes them into the EvidencePack the composer + Harvard-PhD persona
 * expect for the `leasing_financial_performance` report family.
 *
 * Section 13 of the questionnaire memo calls this out as the
 * "Senior-leader most-requested" report — daily / weekly / monthly /
 * quarterly / annual revenue + occupancy + collection performance.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, RevenueLine, OccupancyLine } from './ports.js';
import {
  buildEvidenceFragment,
  collectionPct,
  formatMoney,
  periodWindow,
  sourceHealth,
} from './ports.js';

export interface LeasingFinancialGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createLeasingFinancialGatherer(deps: LeasingFinancialGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const port = deps.ports.leasingFinancial;
    const fragments: EvidencePack['fragments'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];

    if (!port) {
      health.push(sourceHealth('leasing-financial', 'unavailable', 'leasingFinancial port not wired'));
      return Object.freeze({
        type: spec.type,
        spec,
        fragments: Object.freeze(fragments),
        charts: Object.freeze(charts),
        tables: Object.freeze(tables),
        sourceHealth: Object.freeze(health),
      });
    }

    const orgArgs = {
      orgId: extractOrgId(spec.scope),
      ...(extractPropertyId(spec.scope) !== null ? { propertyId: extractPropertyId(spec.scope)! } : {}),
      ...periodWindow(spec),
    };

    let revenue: ReadonlyArray<RevenueLine> = [];
    try {
      revenue = await port.fetchRevenueTrend(orgArgs);
      health.push(sourceHealth('revenue-trend', revenue.length > 0 ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('revenue-trend', 'unavailable', stringifyErr(e)));
    }

    let occupancy: ReadonlyArray<OccupancyLine> = [];
    try {
      occupancy = await port.fetchOccupancyTrend(orgArgs);
      health.push(sourceHealth('occupancy-trend', occupancy.length > 0 ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('occupancy-trend', 'unavailable', stringifyErr(e)));
    }

    revenue.forEach((line, i) => {
      const fragId = `lf-rev-${i + 1}`;
      const collPct = collectionPct(line).toFixed(1);
      fragments.push(
        buildEvidenceFragment({
          id: fragId,
          summary: `${line.periodLabel}: billed ${formatMoney(line.billed)}, collected ${formatMoney(line.collected)} (${collPct}% collection), arrears ${formatMoney(line.arrears)}.`,
          source: { kind: 'ledger_entry', ref: `revenue:${line.periodLabel}` },
          data: { line: { ...line } },
        }),
      );
    });

    occupancy.forEach((line, i) => {
      const fragId = `lf-occ-${i + 1}`;
      const pct = line.totalUnits === 0 ? 0 : (line.leasedUnits / line.totalUnits) * 100;
      fragments.push(
        buildEvidenceFragment({
          id: fragId,
          summary: `${line.periodLabel}: ${line.leasedUnits}/${line.totalUnits} units leased (${pct.toFixed(1)}% occupancy).`,
          source: { kind: 'ledger_entry', ref: `occupancy:${line.periodLabel}` },
          data: { line: { ...line } },
        }),
      );
    });

    if (revenue.length > 0) {
      tables.push({
        id: 'lf-revenue-table',
        title: 'Revenue, collection, and arrears by period',
        headers: ['Period', 'Billed', 'Collected', 'Collection %', 'Arrears'],
        rows: revenue.map((line) => [
          line.periodLabel,
          formatMoney(line.billed),
          formatMoney(line.collected),
          collectionPct(line).toFixed(1),
          formatMoney(line.arrears),
        ]),
        citationIds: revenue.map((_, i) => `lf-rev-${i + 1}`),
      });

      charts.push({
        id: 'lf-revenue-chart',
        title: 'Billed vs collected revenue',
        kind: 'bar',
        xLabels: revenue.map((l) => l.periodLabel),
        series: [
          { name: 'Billed', values: revenue.map((l) => l.billed.value) },
          { name: 'Collected', values: revenue.map((l) => l.collected.value) },
        ],
        yUnit: revenue[0]!.billed.currency,
        citationIds: revenue.map((_, i) => `lf-rev-${i + 1}`),
      });
    }

    if (occupancy.length > 0) {
      charts.push({
        id: 'lf-occupancy-chart',
        title: 'Occupancy trend',
        kind: 'line',
        xLabels: occupancy.map((l) => l.periodLabel),
        series: [
          {
            name: 'Occupancy %',
            values: occupancy.map((l) =>
              l.totalUnits === 0 ? 0 : (l.leasedUnits / l.totalUnits) * 100,
            ),
          },
        ],
        yUnit: '%',
        citationIds: occupancy.map((_, i) => `lf-occ-${i + 1}`),
      });
    }

    return Object.freeze({
      type: spec.type,
      spec,
      fragments: Object.freeze(fragments),
      charts: Object.freeze(charts),
      tables: Object.freeze(tables),
      sourceHealth: Object.freeze(health),
    });
  };
}

function extractOrgId(scope: GathererContext['spec']['scope']): string {
  switch (scope.kind) {
    case 'tenant':
    case 'property':
    case 'deal':
      return scope.orgId;
    case 'portfolio':
      return scope.orgId;
  }
}

function extractPropertyId(scope: GathererContext['spec']['scope']): string | null {
  switch (scope.kind) {
    case 'property':
      return scope.propertyId;
    case 'deal':
      return scope.propertyId ?? null;
    case 'tenant':
    case 'portfolio':
      return null;
  }
}

function stringifyErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
