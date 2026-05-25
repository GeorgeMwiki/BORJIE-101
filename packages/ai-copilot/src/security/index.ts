/**
 * BORJIE AI security suite — Wave-11.
 *
 * Barrel export for all 9 hardening layers. A composition-root factory
 * `createSecuritySuite` wires them together with shared clocks / id
 * generators so downstream services only need to inject one dependency.
 */

import {
  createAuditHashChain,
  type AuditHashChain,
  type AuditChainRepository,
} from './audit-hash-chain.js';
import { createCanaryManager, type CanaryManager } from './canary-tokens.js';
import {
  createCostCircuitBreaker,
  type CostCircuitBreaker,
  type CostCircuitBreakerDeps,
} from './cost-circuit-breaker.js';
import {
  createSecurityObservability,
  type SecurityObservability,
} from './observability.js';

export * from './audit-hash-chain.js';
export * from './canary-tokens.js';
export * from './cost-circuit-breaker.js';
export * from './observability.js';
export * from './output-guard.js';
export * from './owasp-agentic-compliance.js';
export * from './pii-scrubber.js';
export * from './prompt-shield.js';
export * from './tenant-isolation.js';

// ---------------------------------------------------------------------------
// Composition root
// ---------------------------------------------------------------------------

export interface SecuritySuiteDeps {
  readonly auditRepo: AuditChainRepository;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  readonly costBreaker?: CostCircuitBreakerDeps;
  readonly canary?: { readonly tokenCount?: number; readonly cacheLimit?: number };
}

export interface SecuritySuite {
  readonly auditChain: AuditHashChain;
  readonly canary: CanaryManager;
  readonly costBreaker: CostCircuitBreaker;
  readonly observability: SecurityObservability;
}

export function createSecuritySuite(deps: SecuritySuiteDeps): SecuritySuite {
  const nowFn = deps.now ?? (() => new Date());
  const idGen = deps.idGenerator;

  return {
    auditChain: createAuditHashChain({
      repo: deps.auditRepo,
      now: nowFn,
      idGenerator: idGen,
    }),
    canary: createCanaryManager({
      tokenCount: deps.canary?.tokenCount,
      cacheLimit: deps.canary?.cacheLimit,
      now: () => nowFn().getTime(),
    }),
    costBreaker: createCostCircuitBreaker({
      ...(deps.costBreaker ?? {}),
      now: deps.costBreaker?.now ?? (() => nowFn().getTime()),
    }),
    observability: createSecurityObservability({
      idGenerator: idGen,
      now: nowFn,
    }),
  };
}
