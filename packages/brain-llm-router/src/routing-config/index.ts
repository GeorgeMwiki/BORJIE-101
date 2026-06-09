/**
 * @borjie/brain-llm-router/routing-config — control-plane config model +
 * fail-safe resolver. The admin console sets these; the brain-call seam reads
 * them. Storage-agnostic; the gateway binds a Drizzle adapter.
 */

export {
  tenantScope,
  parseTenantFromScope,
  isCombineStrategy,
  ladderFromRouting,
  ALL_COMBINE_STRATEGIES,
} from './config-model.js';
export type {
  ConfigScope,
  PowerFlag,
  CombineStrategy,
  EnsembleConfig,
  LlmRoutingConfig,
  ResolvedRoutingConfig,
} from './config-model.js';

export {
  validateRoutingConfig,
  validateEnsemble,
} from './validate.js';
export type { SchemaResult as RoutingConfigSchemaResult } from './validate.js';

export {
  setRoutingConfigReader,
  resetRoutingConfigReader,
  readInjected,
} from './config-port.js';
export type {
  RoutingConfigPort,
  RoutingConfigReader,
} from './config-port.js';

export { isRoutingConfigEnabled } from './feature-flag.js';

export {
  resolveConfigDrivenLadder,
  resolveEnsembleConfig,
} from './resolver.js';
export type {
  ResolveLadderArgs,
  ConfigDrivenLadder,
} from './resolver.js';

export { InMemoryRoutingConfigAdapter } from './in-memory-adapter.js';
