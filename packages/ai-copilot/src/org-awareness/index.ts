/**
 * Organizational Awareness — make the tenant's real-estate operation
 * "come alive" through Mr. Mwikila.
 *
 * Four public deliverables:
 *   - ProcessMiner / subscribeOrgEvents     process observations + stats
 *   - BottleneckDetector + scheduled task   daily bottleneck scan
 *   - ImprovementTracker                    weekly / monthly metric snapshots
 *   - OrgQueryService                       "talk to your organization" router
 *
 * Tenant isolation is strict throughout: every public method takes
 * tenantId as its first argument and scopes all reads/writes by it.
 */

export * from './types.js';
export * from './in-memory-stores.js';
export * from './process-miner.js';
export * from './event-subscribers.js';
export * from './bottleneck-detector.js';
export * from './improvement-tracker.js';
export * from './query-organization.js';
