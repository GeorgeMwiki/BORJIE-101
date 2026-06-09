/**
 * routing-config/resolver.ts — the FAIL-SAFE config-driven ladder resolver.
 *
 * This is the F1+F3 primary seam: it produces the ordered model ladder for a
 * turn, preferring the admin DB config when present, and falling back to the
 * static `TASK_LADDER` (today's behaviour) on ANY of:
 *   - the routing-config kill-switch being off,
 *   - no injected reader,
 *   - no config row for the scope,
 *   - a malformed config row (validation fails),
 *   - the reader throwing,
 *   - the resolved ladder being empty.
 *
 * INVARIANT (tested): empty / absent / bad config === current static-ladder
 * behaviour. A turn NEVER breaks because of config.
 *
 * GUARDRAIL: a per-use-case override for a LOCKED_CATEGORIES use-case is
 * dropped (the min-tier policy + locked set stay authoritative — admin config
 * can never route a sovereign/legal category off its floor). The ladder
 * elements themselves are still subject to min-tier enforcement downstream at
 * the model-tiering seam; this resolver only decides the candidate ORDER.
 */

import type { ModelTier, TaskKind } from '../types.js';
import { resolveLadder, type TenantLadderMap } from '../task-ladder/task-ladder.js';
import { LOCKED_CATEGORIES } from '../routing-overrides/schema.js';
import {
  ladderFromRouting,
  tenantScope,
  type LlmRoutingConfig,
} from './config-model.js';
import { isRoutingConfigEnabled } from './feature-flag.js';
import { readInjected } from './config-port.js';
import { validateRoutingConfig } from './validate.js';

export interface ResolveLadderArgs {
  readonly task: TaskKind;
  readonly tenantId: string;
  /** The use-case key for per-use-case routing (e.g. an intent / surface). */
  readonly useCase?: string;
  /** In-memory tenant ladder overrides (legacy seam, still honoured). */
  readonly tenantOverrides?: TenantLadderMap;
  /** Explicit per-call override — highest precedence, unchanged behaviour. */
  readonly callOverride?: readonly ModelTier[];
}

export interface ConfigDrivenLadder {
  readonly ladder: readonly ModelTier[];
  /** Where the ladder came from — for telemetry + tests. */
  readonly source: 'call-override' | 'admin-config' | 'static-ladder';
  /** True iff a per-use-case override steered the core model. */
  readonly perUseCaseApplied: boolean;
}

/**
 * Read + validate the admin config for a tenant, preferring the tenant scope
 * then global. Returns null on any miss (fail-safe). Never throws.
 */
function readValidatedConfig(tenantId: string): LlmRoutingConfig | null {
  // Most-specific scope first.
  const tenantRaw = readInjected(tenantScope(tenantId));
  const tenant = coerce(tenantRaw);
  if (tenant) return tenant;
  const globalRaw = readInjected('global');
  return coerce(globalRaw);
}

function coerce(raw: LlmRoutingConfig | null): LlmRoutingConfig | null {
  if (!raw) return null;
  const res = validateRoutingConfig(raw);
  return res.success && res.data ? res.data : null;
}

/**
 * Resolve the effective ordered ladder for a turn.
 *
 * Precedence:
 *   1. explicit per-call override (unchanged legacy behaviour),
 *   2. admin DB config (when the kill-switch is on + a valid row exists),
 *      with an optional per-use-case core override,
 *   3. static TASK_LADDER + in-memory tenant overrides (today's default).
 */
export function resolveConfigDrivenLadder(
  args: ResolveLadderArgs,
): ConfigDrivenLadder {
  // 1. Explicit per-call override wins (and short-circuits config entirely).
  if (args.callOverride !== undefined && args.callOverride.length > 0) {
    return {
      ladder: Object.freeze([...args.callOverride]),
      source: 'call-override',
      perUseCaseApplied: false,
    };
  }

  // 2. Admin config — only when the kill-switch is on.
  if (isRoutingConfigEnabled()) {
    let config: LlmRoutingConfig | null = null;
    try {
      config = readValidatedConfig(args.tenantId);
    } catch {
      // FAIL-SAFE: never let a config read break the turn.
      config = null;
    }
    if (config) {
      const result = ladderFromConfig(config, args.useCase);
      if (result.ladder.length > 0) {
        return result;
      }
    }
  }

  // 3. Static fallback — IDENTICAL to today's behaviour.
  const ladder = resolveLadder(
    args.task,
    args.tenantId,
    args.tenantOverrides ?? {},
    args.callOverride,
  );
  return { ladder, source: 'static-ladder', perUseCaseApplied: false };
}

/**
 * Build the ladder from a validated admin config, applying a per-use-case
 * core override when the use-case is set AND not locked. The fallback chain
 * is preserved beneath the overridden core.
 */
function ladderFromConfig(
  config: LlmRoutingConfig,
  useCase: string | undefined,
): ConfigDrivenLadder {
  let core = config.coreModel;
  let perUseCaseApplied = false;

  if (
    useCase !== undefined &&
    useCase.length > 0 &&
    !LOCKED_CATEGORIES.has(useCase) && // GUARDRAIL: locked use-cases never overridden
    config.perUseCase
  ) {
    const override = config.perUseCase[useCase];
    if (typeof override === 'string' && override.trim().length > 0) {
      core = override;
      perUseCaseApplied = true;
    }
  }

  const base: LlmRoutingConfig = { ...config, coreModel: core };
  const ladder = ladderFromRouting(base);
  return { ladder, source: 'admin-config', perUseCaseApplied };
}

/**
 * Resolve the ensemble config for a turn, fail-safe. Returns null when the
 * kill-switch is off, no config exists, or the config has no enabled
 * ensemble. Never throws.
 */
export function resolveEnsembleConfig(
  tenantId: string,
): LlmRoutingConfig['ensemble'] | null {
  if (!isRoutingConfigEnabled()) return null;
  let config: LlmRoutingConfig | null = null;
  try {
    config = readValidatedConfig(tenantId);
  } catch {
    return null;
  }
  if (!config?.ensemble?.enabled) return null;
  if (config.ensemble.members.length === 0) return null;
  return config.ensemble;
}
