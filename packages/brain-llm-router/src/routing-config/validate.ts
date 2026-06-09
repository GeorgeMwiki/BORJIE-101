/**
 * routing-config/validate.ts — manual validators for the control-plane
 * config shapes.
 *
 * Mirrors the existing routing-overrides/schema.ts style (plain-TS guards,
 * no zod runtime dep in this leaf package — the gateway route layer applies
 * the zod boundary). Returns `SchemaResult<T>` so the caller can surface
 * issues without throwing.
 *
 * FAIL-SAFE CONTRACT: a config that fails validation is treated as ABSENT by
 * the resolver (it falls back to the static TASK_LADDER). Validation here is
 * defence-in-depth so a malformed DB row never reaches the hot path.
 */

import type { ModelTier } from '../types.js';
import {
  ALL_COMBINE_STRATEGIES,
  isCombineStrategy,
  type CombineStrategy,
  type EnsembleConfig,
  type LlmRoutingConfig,
} from './config-model.js';

export interface SchemaResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues?: readonly string[];
}

function isNonEmptyModel(value: unknown): value is ModelTier {
  return typeof value === 'string' && value.trim().length > 0;
}

function isModelArray(value: unknown): value is readonly ModelTier[] {
  return Array.isArray(value) && value.every(isNonEmptyModel);
}

/**
 * Validate an ensemble config sub-object. Members must be a non-empty model
 * array; `judge-synthesis` / `debate` require a judgeModel.
 */
export function validateEnsemble(input: unknown): SchemaResult<EnsembleConfig> {
  if (!input || typeof input !== 'object') {
    return { success: false, issues: ['ensemble: must be an object'] };
  }
  const v = input as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof v.enabled !== 'boolean') {
    issues.push('ensemble.enabled: must be a boolean');
  }
  if (!isModelArray(v.members) || (v.members as readonly ModelTier[]).length === 0) {
    issues.push('ensemble.members: must be a non-empty array of model ids');
  }
  if (!isCombineStrategy(v.combineStrategy)) {
    issues.push(
      `ensemble.combineStrategy: must be one of ${ALL_COMBINE_STRATEGIES.join(', ')}`,
    );
  }
  const strategy = v.combineStrategy as CombineStrategy;
  const needsJudge = strategy === 'judge-synthesis' || strategy === 'debate';
  if (needsJudge && v.judgeModel !== undefined && !isNonEmptyModel(v.judgeModel)) {
    issues.push('ensemble.judgeModel: must be a non-empty model id when present');
  }
  if (issues.length > 0) return { success: false, issues };

  const data: EnsembleConfig = {
    enabled: v.enabled as boolean,
    members: Object.freeze([...(v.members as readonly ModelTier[])]),
    combineStrategy: strategy,
    ...(isNonEmptyModel(v.judgeModel) ? { judgeModel: v.judgeModel } : {}),
  };
  return { success: true, data };
}

/**
 * Validate a full routing config. `coreModel` is required; fallbacks +
 * ensemble + perUseCase are optional but must be well-formed when present.
 */
export function validateRoutingConfig(
  input: unknown,
): SchemaResult<LlmRoutingConfig> {
  if (!input || typeof input !== 'object') {
    return { success: false, issues: ['routing: must be an object'] };
  }
  const v = input as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyModel(v.coreModel)) {
    issues.push('coreModel: must be a non-empty model id');
  }

  const fallbacks =
    v.orderedFallbacks === undefined ? [] : v.orderedFallbacks;
  if (!isModelArray(fallbacks)) {
    issues.push('orderedFallbacks: must be an array of model ids');
  }

  let ensemble: EnsembleConfig | undefined;
  if (v.ensemble !== undefined && v.ensemble !== null) {
    const res = validateEnsemble(v.ensemble);
    if (!res.success) {
      issues.push(...(res.issues ?? []));
    } else {
      ensemble = res.data;
    }
  }

  let perUseCase: Record<string, ModelTier> | undefined;
  if (v.perUseCase !== undefined && v.perUseCase !== null) {
    if (typeof v.perUseCase !== 'object' || Array.isArray(v.perUseCase)) {
      issues.push('perUseCase: must be an object map of useCase -> model id');
    } else {
      perUseCase = {};
      for (const [k, val] of Object.entries(v.perUseCase as Record<string, unknown>)) {
        if (!isNonEmptyModel(val)) {
          issues.push(`perUseCase["${k}"]: must be a non-empty model id`);
          continue;
        }
        perUseCase[k] = val;
      }
    }
  }

  if (issues.length > 0) return { success: false, issues };

  const data: LlmRoutingConfig = {
    coreModel: v.coreModel as ModelTier,
    orderedFallbacks: Object.freeze([...(fallbacks as readonly ModelTier[])]),
    ...(ensemble ? { ensemble } : {}),
    ...(perUseCase ? { perUseCase: Object.freeze({ ...perUseCase }) } : {}),
  };
  return { success: true, data };
}
