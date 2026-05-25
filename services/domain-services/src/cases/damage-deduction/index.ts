/**
 * Damage-Deduction barrel (Wave 26 Agent Z2).
 *
 * Re-exports the damage-deduction domain surface so the composition
 * root can reach the Postgres repository + service class through
 * `@borjie/domain-services/cases` → `DamageDeduction.*`.
 */
export * from './damage-deduction-case.js';
export * from './damage-deduction-service.js';
export { PostgresDamageDeductionRepository } from './postgres-damage-deduction-repository.js';
export type { PostgresDamageDeductionRepositoryClient } from './postgres-damage-deduction-repository.js';
