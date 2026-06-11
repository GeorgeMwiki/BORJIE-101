/**
 * Conformal wrapper — split-conformal / CQR over any provider's raw
 * quantiles. Extends (imports read-only) the existing
 * `@borjie/conformal-calibration-online` ACI substrate.
 */

export {
  calibrateForecast,
  type ConformalMode,
  type CalibrationRecord,
  type ConformalWrapConfig,
  type ConformalWrapResult,
} from './conformal-wrap.js';
