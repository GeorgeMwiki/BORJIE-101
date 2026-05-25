/**
 * Sublease barrel (Wave 26 Agent Z2).
 *
 * Re-exports the sublease domain surface so the composition root can
 * reach the Postgres repositories + service class through
 * `@borjie/domain-services/cases` → `Sublease.*`.
 */
export * from './sublease-request.js';
export * from './tenant-group.js';
export * from './sublease-service.js';
export { PostgresSubleaseRepository } from './postgres-sublease-repository.js';
export type { PostgresSubleaseRepositoryClient } from './postgres-sublease-repository.js';
export { PostgresTenantGroupRepository } from './postgres-tenant-group-repository.js';
export type { PostgresTenantGroupRepositoryClient } from './postgres-tenant-group-repository.js';
