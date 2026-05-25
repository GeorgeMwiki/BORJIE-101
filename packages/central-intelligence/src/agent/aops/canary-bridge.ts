/**
 * Canary bridge — the contract between the AOP registry and the
 * autonomy-governance canary controller (lives in
 * `packages/autonomy-governance/src/slo/canary-controller.ts`).
 *
 * This file is *interface-only*: no import from autonomy-governance.
 * Cross-package wiring is a composition-root concern (avoids a
 * peer-dependency that drags the brain into the governance package's
 * test graph). The composition root supplies an `AOPCanaryAdapter`
 * implementation that calls into the real `demoteStage` / `promoteStage`
 * functions and the real auto-rollback engine.
 *
 * Closed-loop responsibilities encoded here:
 *
 *   1. Before activating a new AOP version, regression pass-rate must
 *      meet `minRegressionPassRate` — else `promote()` returns a
 *      `regression-gate-failed` outcome and does NOT activate.
 *   2. When the SLO monitor reports a breach for an active AOP, the
 *      bridge invokes `rollback()`, which the adapter wires to the
 *      canary controller's `demoteStage` and (on the bottom rung) to
 *      the registry's `setActiveVersion(id, previousVersion)` so the
 *      previous version takes over traffic.
 */

import type { AOPRegistry } from './aop-registry.js';
import type { RegressionReport } from './regression-runner.js';

// ─────────────────────────────────────────────────────────────────────
// Adapter port — wired to autonomy-governance at composition time.
// ─────────────────────────────────────────────────────────────────────

/**
 * Mirrors the autonomy-governance `CanaryStage` literal union but is
 * redeclared locally so this interface file stays import-free.
 */
export type AOPCanaryStage =
  | 'shadow'
  | 'canary-1pct'
  | 'canary-5pct'
  | 'canary-25pct'
  | 'live';

export interface AOPCanaryAdapter {
  /** Current canary stage for an AOP version. Returns `null` when not enrolled. */
  getStage(aopId: string, version: string): Promise<AOPCanaryStage | null>;
  /** Move an AOP version up one stage; throws when already at `live`. */
  promoteStage(aopId: string, version: string): Promise<AOPCanaryStage>;
  /** Move an AOP version down one stage; returns `null` when already at `shadow`. */
  demoteStage(aopId: string, version: string): Promise<AOPCanaryStage | null>;
  /** Enrol a freshly-registered version at `shadow`. */
  enrol(aopId: string, version: string): Promise<void>;
  /** Drop a version from the canary controller entirely (kill-switch). */
  retire(aopId: string, version: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Outcomes
// ─────────────────────────────────────────────────────────────────────

export type PromoteOutcome =
  | { readonly kind: 'promoted'; readonly stage: AOPCanaryStage }
  | { readonly kind: 'activated'; readonly stage: AOPCanaryStage }
  | {
      readonly kind: 'regression-gate-failed';
      readonly passRate: number;
      readonly threshold: number;
    }
  | { readonly kind: 'not-enrolled' };

export type RollbackOutcome =
  | { readonly kind: 'demoted'; readonly fromStage: AOPCanaryStage; readonly toStage: AOPCanaryStage }
  | {
      readonly kind: 'rolled-back-to-previous';
      readonly previousVersion: string;
    }
  | { readonly kind: 'no-previous-version'; readonly retired: true }
  | { readonly kind: 'not-enrolled' };

// ─────────────────────────────────────────────────────────────────────
// Bridge
// ─────────────────────────────────────────────────────────────────────

export interface AOPCanaryBridgeDeps {
  readonly registry: AOPRegistry;
  readonly adapter: AOPCanaryAdapter;
  /**
   * Minimum regression pass-rate (0..1) required to promote a version
   * past `shadow`. Default 0.9 — caller-tunable for tenant overrides.
   */
  readonly minRegressionPassRate?: number;
}

export interface AOPCanaryBridge {
  /**
   * Promote a candidate version one stage up the canary ladder. The
   * caller MUST pass the latest regression report — the bridge checks
   * `report.passRate >= minRegressionPassRate` before promoting.
   * When the candidate would land at `live`, the bridge ALSO flips
   * the registry's active version to this one (atomic activation).
   */
  promote(
    aopId: string,
    version: string,
    report: RegressionReport,
  ): Promise<PromoteOutcome>;
  /**
   * Demote a version one stage on SLO breach. When the version is
   * already at `shadow` *and* a prior version exists in the registry,
   * the bridge flips active back to the prior version and retires the
   * failed candidate from the controller. When no prior version
   * exists the bridge retires the candidate and returns
   * `no-previous-version` so the caller can engage handoff.
   */
  rollback(aopId: string, version: string): Promise<RollbackOutcome>;
}

export function createAOPCanaryBridge(deps: AOPCanaryBridgeDeps): AOPCanaryBridge {
  const threshold = deps.minRegressionPassRate ?? 0.9;

  function previousVersion(aopId: string, current: string): string | null {
    const versions = deps.registry.listVersions(aopId);
    const idx = versions.findIndex((v) => v.version === current);
    if (idx <= 0) return null;
    const prior = versions[idx - 1];
    return prior ? prior.version : null;
  }

  return {
    async promote(aopId, version, report) {
      if (report.aopId !== aopId || report.aopVersion !== version) {
        throw new Error(
          `canary-bridge.promote: report mismatch (got ${report.aopId}@${report.aopVersion}, expected ${aopId}@${version})`,
        );
      }
      if (report.passRate < threshold) {
        return Object.freeze({
          kind: 'regression-gate-failed' as const,
          passRate: report.passRate,
          threshold,
        });
      }
      const current = await deps.adapter.getStage(aopId, version);
      if (current === null) {
        return Object.freeze({ kind: 'not-enrolled' as const });
      }
      const next = await deps.adapter.promoteStage(aopId, version);
      if (next === 'live') {
        await deps.registry.setActiveVersion(aopId, version);
        return Object.freeze({ kind: 'activated' as const, stage: next });
      }
      return Object.freeze({ kind: 'promoted' as const, stage: next });
    },
    async rollback(aopId, version) {
      const current = await deps.adapter.getStage(aopId, version);
      if (current === null) {
        return Object.freeze({ kind: 'not-enrolled' as const });
      }
      const demoted = await deps.adapter.demoteStage(aopId, version);
      if (demoted !== null) {
        return Object.freeze({
          kind: 'demoted' as const,
          fromStage: current,
          toStage: demoted,
        });
      }
      // Already at the bottom rung — retire and try to restore prior version.
      const prior = previousVersion(aopId, version);
      await deps.adapter.retire(aopId, version);
      if (prior !== null) {
        await deps.registry.setActiveVersion(aopId, prior);
        return Object.freeze({
          kind: 'rolled-back-to-previous' as const,
          previousVersion: prior,
        });
      }
      await deps.registry.setActiveVersion(aopId, null);
      return Object.freeze({ kind: 'no-previous-version' as const, retired: true });
    },
  };
}
