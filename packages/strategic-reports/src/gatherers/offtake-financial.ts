/**
 * Offtake financial performance gatherer.
 *
 * Pulls revenue + production trends from the offtake-financial port and
 * shapes them into the EvidencePack the composer + Harvard-PhD persona
 * expect for the `offtake_financial_performance` report family.
 *
 * Section 13 of the questionnaire memo calls this out as the
 * "Senior-leader most-requested" report — daily / weekly / monthly /
 * quarterly / annual revenue + production + collection performance.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, RevenueLine, ProductionLine } from './ports.js';
import {
  buildEvidenceFragment,
  collectionPct,
  formatMoney,
  periodWindow,
  sourceHealth,
} from './ports.js';

export interface OfftakeFinancialGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createOfftakeFinancialGatherer(deps: OfftakeFinancialGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const port = deps.ports.offtakeFinancial;
    const fragments: EvidencePack['fragments'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];

    if (!port) {
      health.push(sourceHealth('offtake-financial', 'unavailable', 'offtakeFinancial port not wired'));
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
      ...(extractSiteId(spec.scope) !== null ? { siteId: extractSiteId(spec.scope)! } : {}),
      ...periodWindow(spec),
    };

    let revenue: ReadonlyArray<RevenueLine> = [];
    try {
      revenue = await port.fetchRevenueTrend(orgArgs);
      health.push(sourceHealth('revenue-trend', revenue.length > 0 ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('revenue-trend', 'unavailable', stringifyErr(e)));
    }

    let production: ReadonlyArray<ProductionLine> = [];
    try {
      production = await port.fetchProductionTrend(orgArgs);
      health.push(sourceHealth('production-trend', production.length > 0 ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('production-trend', 'unavailable', stringifyErr(e)));
    }

    revenue.forEach((line, i) => {
      const fragId = `of-rev-${i + 1}`;
      const collPct = collectionPct(line).toFixed(1);
      fragments.push(
        buildEvidenceFragment({
          id: fragId,
          summary: `${line.periodLabel}: billed ${formatMoney(line.billed)}, collected ${formatMoney(line.collected)} (${collPct}% collection), outstanding ${formatMoney(line.outstanding)}.`,
          source: { kind: 'ledger_entry', ref: `revenue:${line.periodLabel}` },
          data: { line: { ...line } },
        }),
      );
    });

    production.forEach((line, i) => {
      const fragId = `of-prod-${i + 1}`;
      const pct = line.totalSites === 0 ? 0 : (line.producingSites / line.totalSites) * 100;
      fragments.push(
        buildEvidenceFragment({
          id: fragId,
          summary: `${line.periodLabel}: ${line.producingSites}/${line.totalSites} sites producing (${pct.toFixed(1)}% asset utilisation).`,
          source: { kind: 'ledger_entry', ref: `production:${line.periodLabel}` },
          data: { line: { ...line } },
        }),
      );
    });

    if (revenue.length > 0) {
      tables.push({
        id: 'of-revenue-table',
        title: 'Revenue, collection, and outstanding royalties by period',
        headers: ['Period', 'Billed', 'Collected', 'Collection %', 'Outstanding'],
        rows: revenue.map((line) => [
          line.periodLabel,
          formatMoney(line.billed),
          formatMoney(line.collected),
          collectionPct(line).toFixed(1),
          formatMoney(line.outstanding),
        ]),
        citationIds: revenue.map((_, i) => `of-rev-${i + 1}`),
      });

      charts.push({
        id: 'of-revenue-chart',
        title: 'Billed vs collected revenue',
        kind: 'bar',
        xLabels: revenue.map((l) => l.periodLabel),
        series: [
          { name: 'Billed', values: revenue.map((l) => l.billed.value) },
          { name: 'Collected', values: revenue.map((l) => l.collected.value) },
        ],
        yUnit: revenue[0]!.billed.currency,
        citationIds: revenue.map((_, i) => `of-rev-${i + 1}`),
      });
    }

    if (production.length > 0) {
      charts.push({
        id: 'of-production-chart',
        title: 'Asset-utilisation trend',
        kind: 'line',
        xLabels: production.map((l) => l.periodLabel),
        series: [
          {
            name: 'Asset utilisation %',
            values: production.map((l) =>
              l.totalSites === 0 ? 0 : (l.producingSites / l.totalSites) * 100,
            ),
          },
        ],
        yUnit: '%',
        citationIds: production.map((_, i) => `of-prod-${i + 1}`),
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
    case 'buyer':
    case 'site':
    case 'deal':
      return scope.orgId;
    case 'portfolio':
      return scope.orgId;
  }
}

function extractSiteId(scope: GathererContext['spec']['scope']): string | null {
  switch (scope.kind) {
    case 'site':
      return scope.siteId;
    case 'deal':
      return scope.siteId ?? null;
    case 'buyer':
    case 'portfolio':
      return null;
  }
}

function stringifyErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
