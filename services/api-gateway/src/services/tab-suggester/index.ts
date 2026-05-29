/**
 * Tab Suggester service (CT-6).
 *
 * Scans owner activity hourly + emits `<tab_proposal>` candidates into
 * `tab_proposals_inbox`. The chat surface picks the next unresolved
 * proposal on the owner's next turn and renders the accept/dismiss chip.
 *
 * Pattern detectors (v1):
 *   - drill_down_repeat  : same (type, focus) opened ≥3 times in 7 days
 *   - navigation_loop    : same ui_navigate route fired ≥4 times in 24h
 *   - mwikila_escalation : ≥2 T0/T1 proposals on same category in 7 days
 *
 * Every detection cites grounded evidence ids per the Borjie evidence
 * rule (Auditor Agent rejects empty-evidence rows at the route layer).
 *
 * Dedup: before inserting, the detector checks the inbox for an OPEN
 * proposal of the same (tabType, detector) — if one exists, or one
 * was dismissed within the last 7 days, the new detection is skipped.
 *
 * Multi-tenant: every row carries `tenant_id`. The runner accepts a
 * tenant id and binds RLS via the same db middleware the rest of the
 * gateway uses.
 *
 * The service exposes:
 *   - `runTabSuggesterTick({db, tenantId, userId, now})` — one tick
 *      for a single (tenant, user). Returns the proposals created.
 *   - `detectDrillDownRepeat(...)` / `detectNavigationLoop(...)` /
 *     `detectMwikilaEscalation(...)` — pure helpers, easy to test
 *     in isolation.
 */

export {
  detectDrillDownRepeat,
  detectNavigationLoop,
  detectMwikilaEscalation,
  type DetectorInput,
  type DetectorResult,
  type DrillDownObservation,
  type NavigationObservation,
  type MwikilaObservation,
} from './detectors.js';

export {
  runTabSuggesterTick,
  type SuggesterTickInput,
  type SuggesterTickResult,
} from './runner.js';
