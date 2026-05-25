/**
 * Borjie Console — mock barrel. Re-exports per-domain fixtures used as
 * the `fallback` argument to apiClient calls.
 */

export * from './types';
export { MOCK_TENANTS } from './tenants';
export { MOCK_JUNIORS } from './juniors';
export { MOCK_CITATIONS } from './citations';
export { MOCK_CORPUS } from './corpus';
export { MOCK_PROMPTS } from './prompts';
export { MOCK_DECISION_LOG } from './decision-log';
export { MOCK_AUDIT_LOG } from './audit-log';
export { MOCK_SLO } from './slo';
export { MOCK_REGULATOR_PIPELINE } from './regulator-pipeline';
export { MOCK_COMPLIANCE_QUEUE } from './compliance';
export { MOCK_PROMOTIONS } from './rollback';
export { MOCK_KILLSWITCH } from './killswitch';
