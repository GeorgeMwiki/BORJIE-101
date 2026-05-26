/**
 * `@borjie/sae-probe` — public surface (Wave 18BB-gap, research-grade).
 *
 * Sparse Autoencoder runtime probe over Mr. Mwikila's hidden
 * activations. Surfaces interpretable feature firings (deception,
 * hallucination, bias, sycophancy, prompt_injection, self_reference,
 * confidentiality_leak) for governance to react to.
 *
 * Three primitives form the API:
 *
 *   - `detectFeatures`          — pure forward inference of a
 *                                 dictionary over one activation
 *                                 vector. No I/O.
 *   - `resolveThreshold`        — `(dictionary entry, tenant)` →
 *                                 effective threshold with optional
 *                                 tenant override.
 *   - `createProbeRunner`       — composition root: detect + audit +
 *                                 persist a firing per detected
 *                                 feature.
 *
 * Out-of-scope for this wave: training the SAE (Phase 2, GPU). In
 * scope: the contract + storage so trained vectors plug in without
 * re-architecture.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export {
  SAE_FEATURE_CATEGORIES,
  type SaeFeatureCategory,
  type SaeFeatureDictionaryEntry,
  type ActivationVector,
  type SaeProbeFiring,
  type ProbeContext,
  type ProbeFeatureRepository,
  type AuditChainPort,
  type ThresholdOverride,
  type SaeProbeErrorCode,
  SaeProbeError,
  saeFeatureCategorySchema,
  saeFeatureDictionaryEntrySchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------
export {
  resolveThreshold,
  type ResolveThresholdInput,
} from './probe/threshold-policy.js';
export {
  detectFeatures,
  getPlaceholderDictionary,
  type DetectFeaturesInput,
  type DetectedFeature,
} from './probe/feature-detector.js';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
export { createInMemoryProbeFeatureRepository } from './storage/probe-feature-repository.js';

// ---------------------------------------------------------------------------
// Audit chain (in-memory reference impl for tests)
// ---------------------------------------------------------------------------
export {
  createInMemoryAuditChain,
  type InMemoryAuditChain,
} from './audit/audit-chain-link.js';

// ---------------------------------------------------------------------------
// Composition root — detect + audit + persist
// ---------------------------------------------------------------------------

import {
  detectFeatures,
  type DetectedFeature,
} from './probe/feature-detector.js';
import type {
  ActivationVector,
  AuditChainPort,
  ProbeContext,
  ProbeFeatureRepository,
  SaeFeatureDictionaryEntry,
  SaeProbeFiring,
  ThresholdOverride,
} from './types.js';

export interface ProbeRunnerDeps {
  readonly repo: ProbeFeatureRepository;
  readonly audit: AuditChainPort;
}

export interface ProbeRunnerInput {
  readonly activation: ActivationVector;
  readonly dictionary: ReadonlyArray<SaeFeatureDictionaryEntry>;
  readonly overrides?: ReadonlyArray<ThresholdOverride>;
}

export type ProbeRunnerFn = (
  ctx: ProbeContext,
  input: ProbeRunnerInput,
) => Promise<ReadonlyArray<SaeProbeFiring>>;

/**
 * Composition root: runs `detectFeatures`, then for each fired feature
 * appends an audit row + persists a `SaeProbeFiring`. Returns the
 * persisted firings in detection order.
 */
export function createProbeRunner(deps: ProbeRunnerDeps): ProbeRunnerFn {
  return async (ctx, input) => {
    const detectInput = {
      tenant_id: ctx.tenant_id,
      activation: input.activation,
      dictionary: input.dictionary,
      ...(input.overrides !== undefined ? { overrides: input.overrides } : {}),
    };
    const detected: ReadonlyArray<DetectedFeature> = detectFeatures(detectInput);

    const persisted: Array<SaeProbeFiring> = [];
    const now = ctx.now();
    for (const d of detected) {
      const auditHash = await deps.audit.append({
        tenant_id: ctx.tenant_id,
        event_kind: 'sae.feature.fire',
        entity_id: d.feature_id,
        recorded_at: now.toISOString(),
        payload_digest: `${d.feature_id}|${d.activation_strength.toFixed(6)}|${d.threshold_at_time.toFixed(6)}`,
      });
      const firing: SaeProbeFiring = {
        id: generateId('saefire'),
        tenant_id: ctx.tenant_id,
        session_id: ctx.session_id,
        turn_id: ctx.turn_id,
        feature_id: d.feature_id,
        feature_label: d.label,
        category: d.category,
        activation_strength: d.activation_strength,
        threshold_at_time: d.threshold_at_time,
        detected_at: now.toISOString(),
        audit_hash: auditHash,
      };
      await deps.repo.insert(firing);
      persisted.push(firing);
    }
    return persisted;
  };
}

function generateId(prefix: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  const t = Date.now().toString(16);
  return `${prefix}-${t}-${rnd}`;
}
