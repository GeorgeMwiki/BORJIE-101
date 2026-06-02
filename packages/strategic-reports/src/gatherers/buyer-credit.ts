/**
 * Buyer credit + risk profile gatherer.
 *
 * Composes the user-context-store buyer profile + payment history +
 * complaints + credit signals into the EvidencePack for a defensible
 * buyer credit assessment.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, BuyerContextProfile } from './ports.js';
import { buildEvidenceFragment, sourceHealth } from './ports.js';

export interface BuyerCreditGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createBuyerCreditGatherer(deps: BuyerCreditGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];

    const port = deps.ports.buyerContext;
    if (!port) {
      health.push(sourceHealth('buyer-context', 'unavailable', 'buyerContext port not wired'));
      return packed(spec, fragments, [], tables, health);
    }
    if (spec.scope.kind !== 'buyer') {
      health.push(sourceHealth('buyer-context', 'unavailable', 'buyer credit report requires buyer-scoped spec'));
      return packed(spec, fragments, [], tables, health);
    }

    const buyerPersonId = spec.scope.buyerPersonId;
    const orgId = spec.scope.orgId;

    let profile: BuyerContextProfile | null = null;
    try {
      profile = await port.fetchBuyerProfile({ buyerPersonId, orgId });
      health.push(sourceHealth('buyer-context', profile ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('buyer-context', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, [], tables, health);
    }
    if (!profile) return packed(spec, fragments, [], tables, health);

    fragments.push(
      buildEvidenceFragment({
        id: 'bc-stage',
        summary: `Buyer ${profile.displayName} is in lifecycle stage ${profile.lifecycleStage}.`,
        source: { kind: 'buyer_record', ref: `buyer:${profile.buyerPersonId}` },
      }),
    );

    profile.paymentHistory.forEach((p, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `bc-pay-${i + 1}`,
          summary: `${p.periodLabel}: ${p.onTimePct.toFixed(1)}% on-time, ${p.outstandingDays} outstanding days.`,
          source: { kind: 'ledger_entry', ref: `payment:${profile.buyerPersonId}:${p.periodLabel}` },
        }),
      );
    });

    if (profile.paymentHistory.length > 0) {
      tables.push({
        id: 'bc-pay-table',
        title: 'Payment history',
        headers: ['Period', 'On-time %', 'Outstanding days'],
        rows: profile.paymentHistory.map((p) => [p.periodLabel, p.onTimePct.toFixed(1), p.outstandingDays]),
        citationIds: profile.paymentHistory.map((_, i) => `bc-pay-${i + 1}`),
      });
    }

    profile.complaints.forEach((c, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `bc-cmp-${i + 1}`,
          summary: `Complaint ${c.id}${c.resolvedAtIso ? ' (resolved)' : ' (open)'}: ${c.summary}.`,
          source: { kind: 'message', ref: `complaint:${c.id}` },
        }),
      );
    });

    profile.creditSignals.forEach((s, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `bc-sig-${i + 1}`,
          summary: `Credit signal ${s.signal} (weight ${s.weight.toFixed(2)}).`,
          source: { kind: 'computation', ref: `signal:${s.signal}` },
        }),
      );
    });

    if (profile.creditSignals.length > 0) {
      tables.push({
        id: 'bc-sig-table',
        title: 'Credit signals',
        headers: ['Signal', 'Weight'],
        rows: profile.creditSignals.map((s) => [s.signal, s.weight.toFixed(2)]),
        citationIds: profile.creditSignals.map((_, i) => `bc-sig-${i + 1}`),
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
