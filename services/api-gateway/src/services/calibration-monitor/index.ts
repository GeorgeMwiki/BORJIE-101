/**
 * Calibration monitor - Wave CLOSED-LOOP.
 *
 * Barrel for the tracker (reads outcome_predictions +
 * outcome_reconciliations and returns a calibration score) and the
 * alerter (emits a `calibration_drift` event when accuracy crosses
 * the floor). The brain tool that surfaces this for the owner sits
 * in `brain-tool.ts` and is wired through the persona-aware tool
 * catalog by the composition root.
 */

export * from './types';
export {
  createCalibrationTracker,
  type CalibrationTracker,
  type CalibrationTrackerOptions,
} from './tracker';
export {
  createCalibrationAlerter,
  type CalibrationAlerter,
  type CalibrationAlerterOptions,
  type CalibrationDriftEvent,
  type CalibrationDriftSink,
} from './alerter';
export {
  buildCalibrationScoreTool,
  type CalibrationScoreTool,
  type CalibrationScoreToolDeps,
} from './brain-tool';
