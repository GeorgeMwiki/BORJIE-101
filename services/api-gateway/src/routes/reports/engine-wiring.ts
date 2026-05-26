/**
 * Engine wiring for `/v1/strategic-reports`.
 *
 * Holds the singleton `ReportEngine` instance used by the strategic
 * reports router. Production wiring is set by the gateway composition
 * root; tests inject a fake via `setEngineForTests` and reset via
 * `_resetEngineForTests` between cases.
 *
 * Restored after the pre-Borjie hard-fork dropped the original
 * file. Behaviour mirrors the upstream contract documented in
 * `reports.router.ts` and exercised by `__tests__/reports.router.test.ts`.
 */

import type { ReportEngine } from '@borjie/strategic-reports';

let engine: ReportEngine | null = null;

export function getEngine(): ReportEngine | null {
  return engine;
}

export function setEngineForTests(next: ReportEngine | null): void {
  engine = next;
}

export function _resetEngineForTests(): void {
  engine = null;
}
