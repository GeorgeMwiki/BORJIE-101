/**
 * Tool registry — barrel-exports the 9 Process Intel tools.
 *
 * The order matches Microsoft Power Automate Process Mining's grammar
 * (Apr 2026 MCP release) so MD prompts that work against MS PA work
 * here with only the tool-name namespace swapped (`pa.*` -> `process_intel.*`).
 */

import { getProcessesTool } from './get_processes.js';
import { getBottleneckAnalysisTool } from './get_bottleneck_analysis.js';
import { getVariantsWithMetricsTool } from './get_variants_with_metrics.js';
import { getCorrelationTool } from './get_correlation.js';
import { getConformanceTool } from './get_conformance.js';
import { getLoopAnalysisTool } from './get_loop_analysis.js';
import { getHandoffMatrixTool } from './get_handoff_matrix.js';
import { getCycleTimeDistributionTool } from './get_cycle_time_distribution.js';
import { getDriftAlertsTool } from './get_drift_alerts.js';
import type { ProcessIntelTool } from '../types.js';

export {
  getProcessesTool,
  getBottleneckAnalysisTool,
  getVariantsWithMetricsTool,
  getCorrelationTool,
  getConformanceTool,
  getLoopAnalysisTool,
  getHandoffMatrixTool,
  getCycleTimeDistributionTool,
  getDriftAlertsTool,
};

export const PROCESS_INTEL_TOOLS: ReadonlyArray<ProcessIntelTool<unknown>> =
  Object.freeze([
    getProcessesTool,
    getBottleneckAnalysisTool,
    getVariantsWithMetricsTool,
    getCorrelationTool,
    getConformanceTool,
    getLoopAnalysisTool,
    getHandoffMatrixTool,
    getCycleTimeDistributionTool,
    getDriftAlertsTool,
  ]);

export function findProcessIntelTool(
  name: string,
): ProcessIntelTool<unknown> | undefined {
  return PROCESS_INTEL_TOOLS.find((tool) => tool.name === name);
}
