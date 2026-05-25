/**
 * Drift monitoring barrel.
 *
 * `BiasDriftMonitor` maintains rolling baseline + current windows
 * of production observations and uses a two-sample
 * Kolmogorov-Smirnov test to detect when group-specific disparity
 * has drifted. Pattern adapted from the Evidently AI playbook.
 */

export {
  BiasDriftMonitor,
} from './bias-drift-monitor.js';
export type { BiasDriftMonitorOptions } from './bias-drift-monitor.js';
export { twoSampleKS } from './ks-test.js';
