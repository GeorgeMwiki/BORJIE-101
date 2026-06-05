/**
 * Registry-backed line-worker catalogue (Gap 6).
 *
 * A VP decides whether to spawn a line-worker or record a capability gap by
 * asking its `VpLineWorkerCatalogue` whether the named line-worker is
 * registered AND in scope. This adapter answers `has()` from the sub-MD
 * registry: a line-worker is "available" when a real sub-MD factory resolves
 * for its id (canonical or hyphen alias).
 *
 * VP line-workers with no sub-MD yet (`tenant.onboarding-officer`,
 * `inspections.scheduler`, `utility-billing-clerk`, `cashflow-forecaster`,
 * `pricing.analyst`, `employee-coordinator`, `dispute.mediator`, etc.) resolve
 * to `false`, so the VP records an honest `VpCapabilityGap` instead of emitting
 * a spawn the dispatch chain could not run.
 *
 * Pure value module — no I/O. The scope is threaded through for the
 * defense-in-depth tenant guard; today availability is scope-independent
 * (the same eight sub-MDs ship for every tenant), but the signature matches
 * the catalogue contract so a per-tenant enrolment store can drop in later.
 *
 * Mirrors the BN registry-backed catalogue, retargeted real-estate -> mining.
 */

import type { ScopeContext } from '../../types.js';
import { hasSubMd } from '../sub-mds/registry.js';
import type { VpLineWorkerCatalogue } from './shared/vp-base.js';

/**
 * Build a catalogue that reports a line-worker as available iff a real
 * sub-MD is registered for it. Frozen; safe to share across requests
 * (stateless — every `has()` is a pure registry lookup).
 */
export function createRegistryLineWorkerCatalogue(): VpLineWorkerCatalogue {
  return Object.freeze({
    has(args: { readonly name: string; readonly scope: ScopeContext }): boolean {
      // Scope is accepted for the contract + future per-tenant enrolment;
      // referenced here so the parameter is not flagged as unused and the
      // tenant guard seam is explicit.
      if (args.scope.kind !== 'tenant' && args.scope.kind !== 'platform') {
        return false;
      }
      return hasSubMd(args.name);
    },
  });
}
