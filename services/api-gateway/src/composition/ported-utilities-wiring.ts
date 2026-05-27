/**
 * LITFIN-port utilities composition helper.
 *
 * Bundles 5 PO-port LITFIN packages as DI-exposed namespaces so the
 * composition root can expose them on `ServiceRegistry` and consumers
 * (sleep-pass orchestrator, sycophancy / defection probe cron, debate
 * preset, ACI calibration loop) can pull them via dependency injection.
 *
 * All 5 packages ship pure functions (no I/O, no DB). Wiring them
 * here means we never accidentally re-implement their logic anywhere
 * else, and downstream callers always reach for the same canonical
 * surface.
 *
 * Packages bundled:
 *   - `@borjie/audit-hash-chain` (PO-14): append-only HMAC chain
 *   - `@borjie/memory-tool-wire-adapter` (PO-9): Anthropic Memory
 *     Tool wire format ↔ internal topic-files shape
 *   - `@borjie/probe-runners` (PO-18/19): sycophancy + defection
 *     probe schedulers + CI-gate decisions
 *   - `@borjie/property-voices-debate` (PO-7): three-voice property
 *     management debate preset
 *   - `@borjie/conformal-calibration-online` (PO-12): adaptive
 *     conformal-inference α-update state machine
 */

import * as AuditHashChain from '@borjie/audit-hash-chain';
import * as MemoryToolWireAdapter from '@borjie/memory-tool-wire-adapter';
import * as ProbeRunners from '@borjie/probe-runners';
import * as PropertyVoicesDebate from '@borjie/property-voices-debate';
import * as ConformalCalibrationOnline from '@borjie/conformal-calibration-online';

export interface LitfinUtilitiesBundle {
  /** PO-14 — hash-chain audit primitive (append + verify + rotate). */
  readonly auditHashChain: typeof AuditHashChain;
  /** PO-9 — bidirectional Anthropic Memory Tool wire adapter. */
  readonly memoryToolWireAdapter: typeof MemoryToolWireAdapter;
  /** PO-18 / PO-19 — sycophancy + defection probe runners + CI gates. */
  readonly probeRunners: typeof ProbeRunners;
  /** PO-7 — three-voice property management debate preset. */
  readonly propertyVoicesDebate: typeof PropertyVoicesDebate;
  /** PO-12 — adaptive conformal-inference online α-update. */
  readonly conformalCalibrationOnline: typeof ConformalCalibrationOnline;
}

/**
 * Build the LITFIN utilities bundle. Always non-null in both degraded
 * and live mode — every member is a pure-function surface so there is
 * no I/O to short-circuit. Construction is effectively a frozen
 * namespace projection.
 */
export function createLitfinUtilitiesBundle(): LitfinUtilitiesBundle {
  return Object.freeze({
    auditHashChain: AuditHashChain,
    memoryToolWireAdapter: MemoryToolWireAdapter,
    probeRunners: ProbeRunners,
    propertyVoicesDebate: PropertyVoicesDebate,
    conformalCalibrationOnline: ConformalCalibrationOnline,
  });
}
