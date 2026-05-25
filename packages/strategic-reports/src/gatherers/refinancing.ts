/**
 * Refinancing strategy memo gatherer.
 *
 * Composes the lifecycle-advisor's refinancing proposal (LTV/DSCR/debt-yield
 * trade space, lender shortlist, stress tests) into the EvidencePack.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, RefinancingProposal } from './ports.js';
import { buildEvidenceFragment, formatMoney, sourceHealth } from './ports.js';

export interface RefinancingGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createRefinancingGatherer(deps: RefinancingGathererDeps): Gatherer {
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
      health.push(sourceHealth('lifecycle-advisor', 'unavailable', 'refinancing memo requires property scope'));
      return packed(spec, fragments, [], tables, health);
    }

    let proposal: RefinancingProposal | null = null;
    try {
      proposal = await port.fetchRefinancingProposal({ propertyId });
      health.push(sourceHealth('lifecycle-advisor', proposal ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('lifecycle-advisor', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, [], tables, health);
    }
    if (!proposal) return packed(spec, fragments, [], tables, health);

    fragments.push(
      buildEvidenceFragment({
        id: 'rf-current',
        summary: `Current loan principal ${formatMoney(proposal.currentLoan.principal)} at ${proposal.currentLoan.ratePct.toFixed(2)}%, maturity ${proposal.currentLoan.maturityIso}.`,
        source: { kind: 'advisor_output', ref: `lifecycle:refi:${propertyId}:current` },
      }),
    );

    fragments.push(
      buildEvidenceFragment({
        id: 'rf-proposed',
        summary: `Proposed: principal ${formatMoney(proposal.proposed.principal)} at ${proposal.proposed.ratePct.toFixed(2)}%, ${proposal.proposed.term_yrs}-yr term, LTV ${proposal.proposed.ltvPct.toFixed(1)}%, DSCR ${proposal.proposed.dscr.toFixed(2)}.`,
        source: { kind: 'advisor_output', ref: `lifecycle:refi:${propertyId}:proposed` },
      }),
    );

    proposal.lenderShortlist.forEach((l, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `rf-lender-${i + 1}`,
          summary: `Lender ${l.name} fit-score ${l.fitScore.toFixed(2)}.`,
          source: { kind: 'advisor_output', ref: `lifecycle:refi:lender:${l.name}` },
        }),
      );
    });

    if (proposal.lenderShortlist.length > 0) {
      tables.push({
        id: 'rf-lender-table',
        title: 'Lender shortlist',
        headers: ['Lender', 'Fit-score'],
        rows: proposal.lenderShortlist.map((l) => [l.name, l.fitScore.toFixed(2)]),
        citationIds: proposal.lenderShortlist.map((_, i) => `rf-lender-${i + 1}`),
      });
    }

    proposal.stressTests.forEach((s, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `rf-stress-${i + 1}`,
          summary: `Stress ${s.scenario}: DSCR under stress ${s.dscrUnderStress.toFixed(2)}, covenants ${s.covenantOk ? 'PASS' : 'FAIL'}.`,
          source: { kind: 'advisor_output', ref: `lifecycle:refi:stress:${s.scenario}` },
        }),
      );
    });

    if (proposal.stressTests.length > 0) {
      tables.push({
        id: 'rf-stress-table',
        title: 'Stress tests',
        headers: ['Scenario', 'DSCR under stress', 'Covenants'],
        rows: proposal.stressTests.map((s) => [s.scenario, s.dscrUnderStress.toFixed(2), s.covenantOk ? 'PASS' : 'FAIL']),
        citationIds: proposal.stressTests.map((_, i) => `rf-stress-${i + 1}`),
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
