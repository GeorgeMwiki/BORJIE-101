/**
 * VP registry — `createVpByName` factory + name list (Gap 6).
 *
 * Wires the five orphan VP department-heads (Operations, Finance, Growth,
 * People, Risk & Compliance) behind a single name-keyed factory so the
 * `/brain/dispatch` route can resolve a VP by string, hand it the
 * line-worker catalogue, and orchestrate its sub-MDs.
 *
 * Mirrors the BN `createVpByName` + `VP_REGISTRY_NAMES` pattern. Pure value
 * module — no I/O. Each VP is constructed per-call from injected `VpDeps`
 * (the catalogue + clock) so it never closes over request state.
 */

import { createVpOperations } from './vp-operations/index.js';
import { createVpFinance } from './vp-finance/index.js';
import { createVpGrowth } from './vp-growth/index.js';
import { createVpPeople } from './vp-people/index.js';
import { createVpRiskCompliance } from './vp-risk-compliance/index.js';
import type { VpDepartmentHead, VpDeps } from './shared/vp-base.js';

/**
 * Canonical VP names the dispatch route accepts. Order is stable so the
 * roster (`knownVps` in the dispatch response) renders deterministically.
 */
export const VP_REGISTRY_NAMES = Object.freeze([
  'vp.operations',
  'vp.finance',
  'vp.growth',
  'vp.people',
  'vp.risk-compliance',
] as const);

export type VpName = (typeof VP_REGISTRY_NAMES)[number];

/** True when `name` is one of the registered VP names. */
export function isVpName(name: string): name is VpName {
  return (VP_REGISTRY_NAMES as ReadonlyArray<string>).includes(name);
}

/**
 * Resolve a VP department-head by name. Exhaustive over `VpName` so adding a
 * VP to the union without adding a case is a compile error.
 */
export function createVpByName(name: VpName, deps: VpDeps): VpDepartmentHead {
  switch (name) {
    case 'vp.operations':
      return createVpOperations(deps);
    case 'vp.finance':
      return createVpFinance(deps);
    case 'vp.growth':
      return createVpGrowth(deps);
    case 'vp.people':
      return createVpPeople(deps);
    case 'vp.risk-compliance':
      return createVpRiskCompliance(deps);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown VP: ${String(_exhaustive)}`);
    }
  }
}
