/**
 * Sustainability + GHG report gatherer.
 *
 * Composes the sustainability-advisor's snapshot (Scope 1/2/3 +
 * intensity + CRREM delta + EU Taxonomy + BNG + NbS opportunities)
 * into the EvidencePack for an IFRS S2 / TCFD-aligned report.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, SustainabilitySnapshot } from './ports.js';
import { buildEvidenceFragment, sourceHealth } from './ports.js';

export interface SustainabilityGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createSustainabilityGatherer(deps: SustainabilityGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];
    const port = deps.ports.sustainability;
    const propertyId = spec.scope.kind === 'property' ? spec.scope.propertyId : null;

    if (!port) {
      health.push(sourceHealth('sustainability-advisor', 'unavailable', 'sustainability port not wired'));
      return packed(spec, fragments, charts, tables, health);
    }
    if (!propertyId) {
      health.push(sourceHealth('sustainability-advisor', 'unavailable', 'sustainability report requires property scope'));
      return packed(spec, fragments, charts, tables, health);
    }

    let snapshot: SustainabilitySnapshot | null = null;
    try {
      snapshot = await port.fetchSnapshot({
        propertyId,
        periodStart: spec.period.periodStart,
        periodEnd: spec.period.periodEnd,
      });
      health.push(sourceHealth('sustainability-advisor', snapshot ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('sustainability-advisor', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, charts, tables, health);
    }
    if (!snapshot) return packed(spec, fragments, charts, tables, health);

    fragments.push(
      buildEvidenceFragment({
        id: 'sus-scope1',
        summary: `Scope 1: ${snapshot.scope1KgCO2e.toFixed(0)} kgCO2e in ${snapshot.periodLabel}.`,
        source: { kind: 'advisor_output', ref: `sustainability:scope1:${propertyId}` },
      }),
    );
    fragments.push(
      buildEvidenceFragment({
        id: 'sus-scope2',
        summary: `Scope 2: ${snapshot.scope2KgCO2e.toFixed(0)} kgCO2e (market-based) in ${snapshot.periodLabel}.`,
        source: { kind: 'advisor_output', ref: `sustainability:scope2:${propertyId}` },
      }),
    );
    fragments.push(
      buildEvidenceFragment({
        id: 'sus-scope3',
        summary: `Scope 3: ${snapshot.scope3KgCO2e.toFixed(0)} kgCO2e in ${snapshot.periodLabel}.`,
        source: { kind: 'advisor_output', ref: `sustainability:scope3:${propertyId}` },
      }),
    );
    fragments.push(
      buildEvidenceFragment({
        id: 'sus-intensity',
        summary: `Intensity: ${snapshot.intensityKgCO2ePerM2.toFixed(1)} kgCO2e/m² GIA.`,
        source: { kind: 'advisor_output', ref: `sustainability:intensity:${propertyId}` },
      }),
    );
    fragments.push(
      buildEvidenceFragment({
        id: 'sus-crrem',
        summary: `CRREM delta: ${snapshot.crremDeltaPct.toFixed(1)}% vs the 1.5°C pathway.`,
        source: { kind: 'advisor_output', ref: `sustainability:crrem:${propertyId}` },
      }),
    );
    fragments.push(
      buildEvidenceFragment({
        id: 'sus-eut',
        summary: `EU Taxonomy 7.7 alignment: ${snapshot.euTaxonomyAligned ? 'ALIGNED' : 'NOT ALIGNED'}.`,
        source: { kind: 'advisor_output', ref: `sustainability:eu-tax:${propertyId}` },
      }),
    );
    if (snapshot.bngNetGainPct !== undefined) {
      fragments.push(
        buildEvidenceFragment({
          id: 'sus-bng',
          summary: `BNG net-gain: ${snapshot.bngNetGainPct.toFixed(1)}%.`,
          source: { kind: 'advisor_output', ref: `sustainability:bng:${propertyId}` },
        }),
      );
    }
    snapshot.nbsOpportunities.forEach((o, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `sus-nbs-${i + 1}`,
          summary: `NbS opportunity ${o.title} (${o.priority}).`,
          source: { kind: 'advisor_output', ref: `sustainability:nbs:${propertyId}:${o.id}` },
        }),
      );
    });

    tables.push({
      id: 'sus-scope-table',
      title: 'GHG by scope',
      headers: ['Scope', 'kgCO2e'],
      rows: [
        ['Scope 1', snapshot.scope1KgCO2e.toFixed(0)],
        ['Scope 2', snapshot.scope2KgCO2e.toFixed(0)],
        ['Scope 3', snapshot.scope3KgCO2e.toFixed(0)],
      ],
      citationIds: ['sus-scope1', 'sus-scope2', 'sus-scope3'],
      totalRow: [
        'Total',
        (snapshot.scope1KgCO2e + snapshot.scope2KgCO2e + snapshot.scope3KgCO2e).toFixed(0),
      ],
    });

    charts.push({
      id: 'sus-scope-chart',
      title: 'GHG by scope',
      kind: 'stacked_bar',
      xLabels: [snapshot.periodLabel],
      series: [
        { name: 'Scope 1', values: [snapshot.scope1KgCO2e] },
        { name: 'Scope 2', values: [snapshot.scope2KgCO2e] },
        { name: 'Scope 3', values: [snapshot.scope3KgCO2e] },
      ],
      yUnit: 'kgCO2e',
      citationIds: ['sus-scope1', 'sus-scope2', 'sus-scope3'],
    });

    return packed(spec, fragments, charts, tables, health);
  };
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
