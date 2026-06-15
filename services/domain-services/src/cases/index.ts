/**
 * @borjie/domain-services/cases — residual namespace barrel.
 *
 * The residential-property "cases" domain (dispute / legal / SLA case
 * lifecycle) is BossNyumba→mining fork residue: the `cases` table was
 * dropped in 0003_mining_domain.sql and mining uses the `grievances`
 * subsystem as its equivalent. The case service, Postgres repo, SLA
 * worker, state-machine, events and the gateway route/worker were
 * removed on 2026-06-14.
 *
 * Only the co-located Sublease + Damage-Deduction sub-modules survive —
 * they are independently wired into the composition root
 * (`service-registry.ts` → `registry.sublease` / `registry.damageDeductions`)
 * and reach it via this subpath import as `Sublease.*` / `DamageDeduction.*`.
 * Keep this barrel as their re-export point until they are relocated out
 * of `cases/`.
 */
export * as Sublease from './sublease/index.js';
export * as DamageDeduction from './damage-deduction/index.js';

// Branded ID aliases still consumed by the surviving sub-modules above
// (sublease/*, damage-deduction/*). These are the only fragments of the
// retired Cases domain that remain — kept as plain type aliases with zero
// runtime so the sub-modules stay self-sufficient via `../index.js`.
export type CaseId = string & { readonly __brand: 'CaseId' };
export type LeaseId = string & { readonly __brand: 'LeaseId' };
export type CustomerId = string & { readonly __brand: 'CustomerId' };
