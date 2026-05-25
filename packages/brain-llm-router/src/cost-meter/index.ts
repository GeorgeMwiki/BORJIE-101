/**
 * `@borjie/brain-llm-router/cost-meter` — public surface.
 *
 * Per-call $ tracking with per-tenant accumulator + observability
 * hooks. Reuses `MODEL_PRICING` / `computeCost` from cost-cascade.
 *
 * Distinct from cost-cap (which gates spend) and cost-cascade (which
 * picks cheap-first). This module just RECORDS what was actually
 * spent on each call, so:
 *   - the K-B receipt UX can show "this convo cost $0.043"
 *   - the SRE dashboard can show $/min per tenant
 *   - Prometheus can scrape per-tenant cumulative USD
 */

export {
  meterCall,
  getTenantSpend,
  resetTenantSpend,
  resetAllTenantSpend,
  setCostMeterEmitter,
  resetCostMeterEmitter,
  type CostMeterEvent,
  type CostMeterEmitter,
  type MeterCallArgs,
  type TenantSpendSnapshot,
} from './cost-meter.js';
