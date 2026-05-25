/**
 * Composition-root for the strategic-reports engine inside the api-gateway.
 *
 * The real wiring is the responsibility of the service-registry layer
 * (advisor ports come from `@borjie/sustainability-advisor`,
 * `@borjie/acquisition-advisor`, ... ; brain comes from
 * `@borjie/ai-copilot`; document studio comes from
 * `@borjie/document-studio`; audit comes from the WORM audit
 * package). Until those come online we expose a thin override hook:
 *
 *   - `setEngineForTests(engine)`     — substitute a test double
 *   - `getEngine()`                   — used by the router
 *
 * When no engine is wired the router returns a 503 — never a 500 —
 * so callers in dev / staging see a clean degraded-mode signal.
 */

import type { ReportEngine } from '@borjie/strategic-reports';

let engine: ReportEngine | null = null;

export function setEngineForTests(e: ReportEngine | null): void {
  engine = e;
}

export function getEngine(): ReportEngine | null {
  return engine;
}

/**
 * Reset for tests — combined with setEngineForTests this lets the
 * test file own the engine lifecycle per `beforeEach`.
 */
export function _resetEngineForTests(): void {
  engine = null;
}
