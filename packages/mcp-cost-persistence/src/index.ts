/**
 * `@borjie/mcp-cost-persistence` — public surface.
 *
 * Per-MCP-server cost tracking + proactive health probe scheduling
 * (PO-37). Integrates with `packages/mcp/` (P57). Pure kernels;
 * caller injects CostSink + HealthProbe for production wiring.
 */

export * from "./types.js";
export {
  createCostBuffer,
  appendCost,
  flushCost,
  flushAll,
  snapshot,
  type CostBufferState,
  type FlushOptions,
  type FlushResult,
} from "./cost-persistence.js";
export {
  runProbeCycle,
  createHealthHistory,
  recordCycle,
  latestPerServer,
  type ProbeCycleOptions,
  type ProbeCycleResult,
  type HealthHistoryState,
} from "./health-scheduler.js";
