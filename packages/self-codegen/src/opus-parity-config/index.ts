/**
 * Module 9 — opus-parity-config
 * Task budget + adaptive thinking + interleaved thinking presets.
 * Hard NEVERS: bypassPermissions, auto.
 */

export * from './types.js';
export {
  OpusParityConfigViolation,
  validateOpusParityConfig,
  capTaskBudget,
} from './validate-config.js';
