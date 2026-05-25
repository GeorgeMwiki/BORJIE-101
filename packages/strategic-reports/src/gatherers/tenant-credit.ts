/**
 * Tenant credit + risk profile gatherer.
 *
 * Composes the user-context-store tenant profile + payment history +
 * complaints + credit signals into the EvidencePack for a defensible
 * tenant credit assessment.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, TenantContextProfile } from './ports.js';
import { buildEvidenceFragment, sourceHealth } from './ports.js';

export interface TenantCreditGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createTenantCreditGatherer(deps: TenantCreditGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];

    const port = deps.ports.tenantContext;
    if (!port) {
      health.push(sourceHealth('tenant-context', 'unavailable', 'tenantContext port not wired'));
      return packed(spec, fragments, [], tables, health);
    }
    if (spec.scope.kind !== 'tenant') {
      health.push(sourceHealth('tenant-context', 'unavailable', 'tenant credit report requires tenant-scoped spec'));
      return packed(spec, fragments, [], tables, health);
    }

    const tenantPersonId = spec.scope.tenantPersonId;
    const orgId = spec.scope.orgId;

    let profile: TenantContextProfile | null = null;
    try {
      profile = await port.fetchTenantProfile({ tenantPersonId, orgId });
      health.push(sourceHealth('tenant-context', profile ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('tenant-context', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, [], tables, health);
    }
    if (!profile) return packed(spec, fragments, [], tables, health);

    fragments.push(
      buildEvidenceFragment({
        id: 'tc-stage',
        summary: `Tenant ${profile.displayName} is in lifecycle stage ${profile.lifecycleStage}.`,
        source: { kind: 'tenant_record', ref: `tenant:${profile.tenantPersonId}` },
      }),
    );

    profile.paymentHistory.forEach((p, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `tc-pay-${i + 1}`,
          summary: `${p.periodLabel}: ${p.onTimePct.toFixed(1)}% on-time, ${p.arrearsDays} arrears days.`,
          source: { kind: 'ledger_entry', ref: `payment:${profile.tenantPersonId}:${p.periodLabel}` },
        }),
      );
    });

    if (profile.paymentHistory.length > 0) {
      tables.push({
        id: 'tc-pay-table',
        title: 'Payment history',
        headers: ['Period', 'On-time %', 'Arrears days'],
        rows: profile.paymentHistory.map((p) => [p.periodLabel, p.onTimePct.toFixed(1), p.arrearsDays]),
        citationIds: profile.paymentHistory.map((_, i) => `tc-pay-${i + 1}`),
      });
    }

    profile.complaints.forEach((c, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `tc-cmp-${i + 1}`,
          summary: `Complaint ${c.id}${c.resolvedAtIso ? ' (resolved)' : ' (open)'}: ${c.summary}.`,
          source: { kind: 'message', ref: `complaint:${c.id}` },
        }),
      );
    });

    profile.creditSignals.forEach((s, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `tc-sig-${i + 1}`,
          summary: `Credit signal ${s.signal} (weight ${s.weight.toFixed(2)}).`,
          source: { kind: 'computation', ref: `signal:${s.signal}` },
        }),
      );
    });

    if (profile.creditSignals.length > 0) {
      tables.push({
        id: 'tc-sig-table',
        title: 'Credit signals',
        headers: ['Signal', 'Weight'],
        rows: profile.creditSignals.map((s) => [s.signal, s.weight.toFixed(2)]),
        citationIds: profile.creditSignals.map((_, i) => `tc-sig-${i + 1}`),
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
