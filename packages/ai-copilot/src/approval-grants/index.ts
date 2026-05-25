/**
 * Approval grants — public barrel.
 *
 * Exposes the service, types, and in-memory repo. Production Postgres
 * adapter lives in the api-gateway composition root and implements
 * `ApprovalGrantRepository` from this package.
 */

export * from './types.js';
export {
  ApprovalGrantService,
  InMemoryApprovalGrantRepository,
} from './service.js';
export type { ApprovalGrantServiceDeps } from './service.js';
