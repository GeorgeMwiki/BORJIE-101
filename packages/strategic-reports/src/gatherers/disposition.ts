/**
 * Disposition memo + asset profile gatherer.
 *
 * Composes the lifecycle-advisor's disposition thesis (recommended
 * exit, buyer pool, sensitivities) into the EvidencePack.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, DispositionThesis } from './ports.js';
import { buildEvidenceFragment, formatMoney, sourceHealth } from './ports.js';

export interface DispositionGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createDispositionGatherer(deps: DispositionGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];

    const port = deps.ports.lifecycle;
    const propertyId = spec.scope.kind === 'property' ? spec.scope.propertyId : null;

    if (!port) {
      health.push(sourceHealth('lifecycle-advisor', 'unavailable', 'lifecycle port not wired'));
      return packed(spec, fragments, [], tables, health);
    }
    if (!propertyId) {
      health.push(sourceHealth('lifecycle-advisor', 'unavailable', 'disposition memo requires property scope'));
      return packed(spec, fragments, [], tables, health);
    }

    let thesis: DispositionThesis | null = null;
    try {
      thesis = await port.fetchDispositionThesis({ propertyId });
      health.push(sourceHealth('lifecycle-advisor', thesis ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('lifecycle-advisor', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, [], tables, health);
    }

    if (!thesis) return packed(spec, fragments, [], tables, health);

    fragments.push(
      buildEvidenceFragment({
        id: 'd-exit',
        summary: `Recommended exit: ${thesis.recommendedExit}. Implied exit value ${formatMoney(thesis.impliedExitValue)}.`,
        source: { kind: 'advisor_output', ref: `lifecycle:disposition:${propertyId}` },
        data: { thesis },
      }),
    );

    thesis.buyerPool.forEach((bp, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `d-buyer-${i + 1}`,
          summary: `Buyer pool ${bp.buyerType} weight ${(bp.weight * 100).toFixed(1)}%.`,
          source: { kind: 'advisor_output', ref: `lifecycle:buyer-pool:${propertyId}:${bp.buyerType}` },
        }),
      );
    });

    if (thesis.buyerPool.length > 0) {
      tables.push({
        id: 'd-buyer-table',
        title: 'Buyer pool weights',
        headers: ['Buyer type', 'Weight %'],
        rows: thesis.buyerPool.map((bp) => [bp.buyerType, (bp.weight * 100).toFixed(1)]),
        citationIds: thesis.buyerPool.map((_, i) => `d-buyer-${i + 1}`),
      });
    }

    thesis.sensitivities.forEach((s, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `d-sens-${i + 1}`,
          summary: `Sensitivity ${s.factor}: delta ${s.delta} → impact ${s.impactPct.toFixed(1)}%.`,
          source: { kind: 'advisor_output', ref: `lifecycle:sensitivity:${propertyId}:${s.factor}` },
        }),
      );
    });

    if (thesis.sensitivities.length > 0) {
      tables.push({
        id: 'd-sens-table',
        title: 'Sensitivity table',
        headers: ['Factor', 'Delta', 'Impact %'],
        rows: thesis.sensitivities.map((s) => [s.factor, s.delta, s.impactPct.toFixed(1)]),
        citationIds: thesis.sensitivities.map((_, i) => `d-sens-${i + 1}`),
      });
    }

    return packed(spec, fragments, [], tables, health);
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
