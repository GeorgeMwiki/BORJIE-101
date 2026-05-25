/**
 * @borjie/compliance-pack — public surface.
 *
 * Bundles 10 framework control catalogs + DSAR automation + erasure
 * cascade with legal-hold + envelope encryption + residency policy +
 * breach notification. Pure functions, no DB / KMS dependency at the
 * type level.
 *
 * Quick start:
 *   import {
 *     ALL_CATALOGS,
 *     controlsByJurisdiction,
 *     createDSARService,
 *     createInMemoryEnvelopeEncryptor,
 *     buildErasureCascade,
 *     checkResidency,
 *     requiredNotifications,
 *     createComplianceEngine,
 *   } from '@borjie/compliance-pack';
 */

import { createDSARService, type DSARService, type DSARServiceDeps } from './dsar/index.js';
import {
  type CascadeRunner,
  buildErasureCascade,
} from './erasure-cascade/index.js';
import {
  bindField,
  type EnvelopeEncryptor,
  type FieldBoundEncryptor,
} from './encryption/index.js';
import type { EncryptionContext } from './types.js';
import {
  defineResidencyPolicy,
  type ResidencyChecker,
} from './residency/index.js';
import type { ResidencyPolicy } from './types.js';

export * from './types.js';
export * from './frameworks/index.js';
export * from './dsar/index.js';
export * from './erasure-cascade/index.js';
export * from './encryption/index.js';
export * from './residency/index.js';
export * from './breach/index.js';

// ─────────────────────────────────────────────────────────────────────
// Top-level convenience factory
// ─────────────────────────────────────────────────────────────────────

export interface ComplianceEngineDeps {
  /** DSAR-service collectors. */
  readonly collectors: DSARServiceDeps['collectors'];
  /** Envelope encryptor (in-memory or KMS). */
  readonly encryptor: EnvelopeEncryptor;
  /** Residency policy for the tenant the engine serves. */
  readonly residency: ResidencyPolicy;
  /** Optional cascade runner. Defaults to `buildErasureCascade()`. */
  readonly cascadeRunner?: CascadeRunner | undefined;
  readonly now?: (() => Date) | undefined;
  readonly idFactory?: (() => string) | undefined;
}

export interface ComplianceEngine {
  readonly dsar: DSARService;
  readonly residency: ResidencyChecker;
  readonly encryptor: EnvelopeEncryptor;
  readonly cascadeRunner: CascadeRunner;
  bindField(context: EncryptionContext): FieldBoundEncryptor;
}

/**
 * Wire the compliance pack into a single engine object. Convenience
 * for the common case — call-sites that need only one subsystem can
 * import the factories directly.
 */
export function createComplianceEngine(deps: ComplianceEngineDeps): ComplianceEngine {
  const cascadeRunner = deps.cascadeRunner ?? buildErasureCascade();
  const dsar = createDSARService({
    collectors: deps.collectors,
    cascadeRunner,
    now: deps.now,
    idFactory: deps.idFactory,
  });
  const residency = defineResidencyPolicy(deps.residency);

  return {
    dsar,
    residency,
    encryptor: deps.encryptor,
    cascadeRunner,
    bindField: (context) => bindField(deps.encryptor, context),
  };
}
