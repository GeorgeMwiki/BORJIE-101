/**
 * Opportunity Scanner — public barrel.
 *
 * Mr. Mwikila proactively scans the owner's tenant state for upside
 * (cost saves, revenue, tax efficiency, regulatory windows, market
 * timing, peer best practices, etc.) every conversational turn.
 * Surfaces the top-ranked Opportunity blocks below the AI bubble via
 * SSE `opportunity_proposed` events.
 *
 * Entry points consumed by the api-gateway:
 *
 *   - `scanOpportunities(state, options)`  — pure ranking engine
 *   - `resolveScanState(db, tenantId)`     — RLS-bound state builder
 *   - `SCAN_RULES`                          — dedup'd rule catalog
 *   - `parseOpportunityBlocks(text)`        — server-side SSE parser
 *                                             (lives at routes/opportunity-block-parser.ts)
 *
 * Brain tools `mining.opportunities.scan|expand|schedule` are
 * registered via composition/brain-tools/opportunity-scanner-tools.ts.
 */

export type {
  Opportunity,
  OpportunityAction,
  OpportunityKind,
  ScanRule,
  ScanState,
  Bilingual,
} from './types';
export {
  OpportunitySchema,
  OpportunityActionSchema,
  OPPORTUNITY_KINDS,
  BilingualSchema,
} from './types';

export { SCAN_RULES, ALL_SCAN_RULES } from './scan-rules';

export {
  scanOpportunities,
  renderOpportunityHeadline,
  renderOpportunityNarrative,
  type ScanOptions,
} from './scanner';

export {
  resolveScanState,
  type ScanStateResolverDb,
} from './resolver';
