/**
 * Runtime guard. The HARD NEVERS:
 *   1. permissionMode === 'bypassPermissions' → throw.
 *   2. permissionMode === 'auto' → throw (TS-only and a known PI surface).
 *   3. taskBudgetCents <= 0 → throw.
 *   4. allowedTools intersects disallowedTools → throw.
 */

import { type OpusParityConfig } from './types.js';

export class OpusParityConfigViolation extends Error {
  public readonly reason: string;
  public constructor(reason: string) {
    super(`Opus-parity config rejected: ${reason}`);
    this.name = 'OpusParityConfigViolation';
    this.reason = reason;
  }
}

const FORBIDDEN_MODES = new Set(['bypassPermissions', 'auto']);

export function validateOpusParityConfig(
  config: Partial<OpusParityConfig> & { readonly permissionMode?: string },
): asserts config is OpusParityConfig {
  if (config.permissionMode && FORBIDDEN_MODES.has(config.permissionMode)) {
    throw new OpusParityConfigViolation(
      `permissionMode "${config.permissionMode}" is HARD NEVER. Use 'plan', 'default', 'dontAsk', or 'acceptEdits'.`,
    );
  }
  if (config.taskBudgetCents !== undefined && config.taskBudgetCents <= 0) {
    throw new OpusParityConfigViolation(
      `taskBudgetCents must be > 0 (got ${config.taskBudgetCents})`,
    );
  }
  const allowed = new Set(config.allowedTools ?? []);
  const disallowed = config.disallowedTools ?? [];
  for (const d of disallowed) {
    if (allowed.has(d)) {
      throw new OpusParityConfigViolation(
        `Tool "${d}" appears in both allowedTools AND disallowedTools. deny wins; please remove from allowedTools.`,
      );
    }
  }
  if (config.extendedThinkingEffort) {
    const valid = ['low', 'medium', 'high', 'xhigh'];
    if (!valid.includes(config.extendedThinkingEffort)) {
      throw new OpusParityConfigViolation(
        `extendedThinkingEffort "${config.extendedThinkingEffort}" not in ${valid.join('|')}`,
      );
    }
  }
}

/**
 * Hard-cap a budget request — never lets the caller exceed the package
 * default of $1000, no matter what is passed.
 */
export function capTaskBudget(requestedCents: number, hardCap = 100_000): number {
  if (!Number.isFinite(requestedCents) || requestedCents <= 0) {
    throw new OpusParityConfigViolation(
      `Invalid task budget: ${requestedCents}`,
    );
  }
  return Math.min(requestedCents, hardCap);
}
