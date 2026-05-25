/**
 * @borjie/security-hardening
 *
 * Public surface — every subsystem is independently importable from the
 * deep paths so callers can tree-shake unused subsystems.
 *
 * One-stop factory: `createSecurityHardening(...)` returns wired-up
 * services for the common subsystems (anomaly detector, rate-limit
 * store, step-up MFA, security-headers middleware). The WebAuthn and
 * HIBP services are NOT auto-constructed — they require an injected
 * adapter (`@simplewebauthn/server` shim) or a `fetch` shim, both of
 * which the caller is best placed to wire.
 */

export * from './types.js';
export * from './webauthn/index.js';
export * from './mfa/index.js';
export * from './headers/index.js';
export * from './rate-limit/index.js';
export * from './anomaly/index.js';
export * from './credential-checks/index.js';

import { createSecurityHeadersMiddleware } from './headers/middleware.js';
import type { SecurityHeaderEnv } from './types.js';
import {
  createRateLimiter,
  type RateLimitLimits,
  type RateLimiter,
} from './rate-limit/limiter.js';
import {
  createInMemoryRateLimitStore,
  type RateLimitStore,
} from './rate-limit/store.js';
import {
  createStepUpService,
  createInMemoryStepUpStore,
  type StepUpService,
  type StepUpStore,
} from './mfa/step-up.js';
import {
  createAnomalyDetector,
  type AnomalyDetector,
  type AnomalyDetectorOptions,
} from './anomaly/detector.js';
import {
  createCredentialStuffingDetector,
  type StuffingDetector,
  type StuffingDetectorOptions,
} from './credential-checks/stuffing.js';

export interface CreateSecurityHardeningOptions {
  readonly headersEnv: SecurityHeaderEnv;
  readonly rateLimitStore?: RateLimitStore;
  readonly defaultRateLimit?: RateLimitLimits;
  readonly stepUpStore?: StepUpStore;
  readonly stepUpFreshnessMs?: number;
  readonly anomaly?: AnomalyDetectorOptions;
  readonly stuffing?: StuffingDetectorOptions;
}

export interface SecurityHardening {
  readonly headersMiddleware: ReturnType<
    typeof createSecurityHeadersMiddleware
  >;
  readonly defaultRateLimiter?: RateLimiter;
  readonly stepUp: StepUpService;
  readonly anomalyDetector: AnomalyDetector;
  readonly stuffingDetector: StuffingDetector;
}

export function createSecurityHardening(
  opts: CreateSecurityHardeningOptions,
): SecurityHardening {
  const rateLimitStore = opts.rateLimitStore ?? createInMemoryRateLimitStore();
  const defaultRateLimiter = opts.defaultRateLimit
    ? createRateLimiter({
        algorithm: opts.defaultRateLimit.algorithm,
        store: rateLimitStore,
        limits: opts.defaultRateLimit,
      })
    : undefined;

  return {
    headersMiddleware: createSecurityHeadersMiddleware({
      env: opts.headersEnv,
    }),
    ...(defaultRateLimiter ? { defaultRateLimiter } : {}),
    stepUp: createStepUpService({
      store: opts.stepUpStore ?? createInMemoryStepUpStore(),
      freshnessMs: opts.stepUpFreshnessMs ?? 5 * 60 * 1000,
    }),
    anomalyDetector: createAnomalyDetector(opts.anomaly),
    stuffingDetector: createCredentialStuffingDetector(opts.stuffing),
  };
}
