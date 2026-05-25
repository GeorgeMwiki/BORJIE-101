/**
 * Acquisition deal IC memo gatherer.
 *
 * Composes the acquisition-advisor port output (modelled value, comp
 * triangulation, deal-killers, recommendation) into the EvidencePack
 * for an Investment-Committee-grade memo.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, AcquisitionDeal } from './ports.js';
import { buildEvidenceFragment, formatMoney, sourceHealth } from './ports.js';

export interface AcquisitionIcGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createAcquisitionIcGatherer(deps: AcquisitionIcGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];

    const port = deps.ports.acquisition;
    if (!port) {
      health.push(sourceHealth('acquisition-advisor', 'unavailable', 'acquisition port not wired'));
      return packed(spec, fragments, charts, tables, health);
    }

    const dealId = scopeDealId(spec.scope);
    if (!dealId) {
      health.push(sourceHealth('acquisition-advisor', 'unavailable', 'acquisition IC requires a deal-scoped spec'));
      return packed(spec, fragments, charts, tables, health);
    }

    let deal: AcquisitionDeal | null = null;
    try {
      deal = await port.fetchDeal({ dealId });
      health.push(sourceHealth('acquisition-advisor', deal ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('acquisition-advisor', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, charts, tables, health);
    }

    if (!deal) return packed(spec, fragments, charts, tables, health);

    fragments.push(
      buildEvidenceFragment({
        id: 'ic-ask',
        summary: `Ask price ${formatMoney(deal.askPrice)} on NOI ${formatMoney(deal.noi)} implies cap-rate ${(deal.impliedCapRate * 100).toFixed(2)}%.`,
        source: { kind: 'advisor_output', ref: `acquisition:${deal.dealId}:ask` },
        data: { askPrice: deal.askPrice, noi: deal.noi, impliedCapRate: deal.impliedCapRate },
      }),
    );

    fragments.push(
      buildEvidenceFragment({
        id: 'ic-modelled',
        summary: `Modelled value ${formatMoney(deal.modelledValue)} versus ask ${formatMoney(deal.askPrice)}.`,
        source: { kind: 'advisor_output', ref: `acquisition:${deal.dealId}:modelled-value` },
        data: { modelledValue: deal.modelledValue },
      }),
    );

    fragments.push(
      buildEvidenceFragment({
        id: 'ic-comp-range',
        summary: `Comp triangulation range ${formatMoney(deal.compTriangulationRange.low)} → ${formatMoney(deal.compTriangulationRange.high)}.`,
        source: { kind: 'advisor_output', ref: `acquisition:${deal.dealId}:comp-range` },
        data: { compTriangulationRange: deal.compTriangulationRange },
      }),
    );

    deal.dealKillers.forEach((dk, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `ic-dk-${i + 1}`,
          summary: `Deal-killer ${dk.id} (${dk.severity}): ${dk.title}.`,
          source: { kind: 'advisor_output', ref: `acquisition:${deal.dealId}:dk:${dk.id}` },
          data: { dealKiller: { ...dk } },
        }),
      );
    });

    if (deal.dealKillers.length > 0) {
      tables.push({
        id: 'ic-dk-table',
        title: 'Deal-killer table',
        headers: ['Id', 'Severity', 'Title'],
        rows: deal.dealKillers.map((dk) => [dk.id, dk.severity, dk.title]),
        citationIds: deal.dealKillers.map((_, i) => `ic-dk-${i + 1}`),
      });
    }

    tables.push({
      id: 'ic-valuation-table',
      title: 'Valuation triangulation',
      headers: ['Source', 'Value'],
      rows: [
        ['Ask price', formatMoney(deal.askPrice)],
        ['Modelled value', formatMoney(deal.modelledValue)],
        ['Comp low', formatMoney(deal.compTriangulationRange.low)],
        ['Comp high', formatMoney(deal.compTriangulationRange.high)],
      ],
      citationIds: ['ic-ask', 'ic-modelled', 'ic-comp-range'],
    });

    fragments.push(
      buildEvidenceFragment({
        id: 'ic-recommendation',
        summary: `Advisor recommendation: ${deal.recommendation.toUpperCase()}.`,
        source: { kind: 'advisor_output', ref: `acquisition:${deal.dealId}:recommendation` },
        data: { recommendation: deal.recommendation },
      }),
    );

    return packed(spec, fragments, charts, tables, health);
  };
}

function scopeDealId(scope: GathererContext['spec']['scope']): string | null {
  return scope.kind === 'deal' ? scope.dealId : null;
}

function packed(
  spec: GathererContext['spec'],
  fragments: EvidencePack['fragments'][number][],
  charts: EvidencePack['charts'][number][],
  tables: EvidencePack['tables'][number][],
  health: EvidencePack['sourceHealth'][number][],
): EvidencePack {
  return Object.freeze({
    type: spec.type,
    spec,
    fragments: Object.freeze(fragments),
    charts: Object.freeze(charts),
    tables: Object.freeze(tables),
    sourceHealth: Object.freeze(health),
  });
}
