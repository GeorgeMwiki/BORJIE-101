/**
 * DP-Memory barrel — Wave 28 Agent DP-MEMORY.
 *
 * Public surface for the differential-privacy cross-tenant pattern-memory
 * layer. Exports the primitives (Laplace / Gaussian / composition), the
 * stateful services (budget ledger, consent manager, pattern aggregator,
 * shared defaults, cross-tenant query), and every type the services
 * speak.
 */

export * from './types.js';

export {
  addLaplaceNoise,
  addGaussianNoise,
  sampleLaplace,
  sampleStandardNormal,
  basicComposition,
  advancedComposition,
  laplaceConfidenceInterval,
  mulberry32,
  type RandomSource,
} from './differential-privacy.js';

export {
  PrivacyBudgetLedger,
  InMemoryPrivacyBudgetRepository,
  BudgetExceededError,
  DEFAULT_MONTHLY_EPSILON,
  DEFAULT_PLAN_TIER_BUDGETS,
  type PrivacyBudgetLedgerConfig,
} from './privacy-budget-ledger.js';

export {
  ConsentManager,
  InMemoryConsentRepository,
  DEFAULT_CONSENT,
  type ConsentManagerConfig,
} from './consent-manager.js';

export {
  PatternAggregator,
  ContributionRejectedError,
  MIN_CONTRIBUTION_SAMPLE_SIZE,
  CONTRIBUTION_VALUE_QUANTUM,
  type PatternAggregatorConfig,
  type ContributionRejectionReason,
} from './pattern-aggregator.js';

export {
  SharedDefaultsService,
  InMemorySharedDefaultRepository,
  DEFAULT_SHARED_DEFAULT_TTL_MS,
  deriveJurisdiction,
  type SharedDefaultsServiceConfig,
  type PublishDefaultInput,
} from './shared-defaults.js';

export {
  CrossTenantQueryService,
  InsufficientAggregationError,
  MIN_CONTRIBUTING_TENANTS_DEFAULT,
  type CrossTenantQueryServiceConfig,
  type QueryOptions,
} from './cross-tenant-query.js';
