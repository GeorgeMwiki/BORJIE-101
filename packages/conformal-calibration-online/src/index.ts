/**
 * `@borjie/conformal-calibration-online` — public surface.
 *
 * Adaptive Conformal Inference (ACI) — online α-update for prediction
 * intervals (PO-12). Pure state machine; integrates with
 * `packages/forecasting-engine` for rent / vacancy / maintenance
 * forecast calibration.
 */

export * from "./types.js";
export {
  createOnlineConformalState,
  updateConformal,
  applyBatch,
  currentAlpha,
  diagnostic,
  conformalThresholdAt,
  type UpdateOptions,
} from "./aci.js";
