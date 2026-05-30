/**
 * Brain-tools barrel — assembles the persona-aware tool catalog.
 *
 * `buildPersonaToolHandlers(gate)` is the single entry point called from
 * `brain-extensions.ts`. It:
 *
 *   1. Concatenates the five persona-scoped catalogs (owner / manager /
 *      worker / buyer / admin) with the shared catalog.
 *   2. Deduplicates by tool id (defensive — DRAFT-Tools agent owns the
 *      parallel `draft_*` family; if either agent re-registers the same
 *      id by accident, the first occurrence wins and a warning surfaces
 *      via the optional `onDuplicate` callback).
 *   3. Wraps each descriptor with `toBrainToolHandler` so the
 *      orchestrator's `ToolDispatcher` can register it.
 *
 * Tenant isolation: each handler resolves `tenantId` from the
 * tool-execution context per call. No descriptor closes over a tenant
 * identifier.
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import { z } from 'zod';
import {
  toBrainToolHandler,
  type PersonaToolDescriptor,
  type PersonaToolGate,
} from './types';
import { SHARED_TOOLS } from './shared-tools';
import { OWNER_TOOLS } from './owner-tools';
import { OWNER_ESTATE_TOOLS } from './owner-estate-tools';
import { MANAGER_TOOLS } from './manager-tools';
import { WORKER_TOOLS } from './worker-tools';
import { BUYER_TOOLS } from './buyer-tools';
import { ADMIN_TOOLS } from './admin-tools';
import { SCOPE_TOOLS } from './scope-tools';
import { MD_INTELLIGENCE_TOOLS } from './md-intelligence-tools';
import { WORKFORCE_CLOCK_IN_TOOLS } from './workforce-clock-in-tools';
import { MINING_PRODUCTION_TOOLS } from './mining-production-tools';
import { COOPERATIVE_TOOLS } from './cooperative-tools';
import { INSURANCE_TOOLS } from './insurance-tools';
import { OWNER_MESSAGING_TOOLS } from './owner-messaging-tools';
// Roadmap R2 — `owner.saved_search.create` lifts the saved-search
// create flow into the brain catalog so the owner can spin up alert
// rules from chat. Defers to /owner/saved-searches via the loopback
// HTTP client.
import { OWNER_SAVED_SEARCH_TOOLS } from './owner-saved-search-tools';
import { SUPERPOWERS_TOOLS } from './superpowers-tools';
import { DECISION_JOURNAL_TOOLS } from './decision-journal-tools';
import { ENTITY_LEGIBILITY_TOOLS } from './entity-legibility-tools';
// Wave UNWIRED-LOGIC-SWEEP-2 — opportunity + risk scanner brain tools.
// Surfaces the existing 33-rule opportunity scanner and 33-rule risk
// scanner (services/opportunity-scanner/, services/risk-scanner/) into
// the persona-aware brain tool catalog. Both engines previously shipped
// complete but no brain tool existed, leaving them dormant.
import { OPPORTUNITY_SCANNER_TOOLS } from './opportunity-scanner-tools';
import { RISK_SCANNER_TOOLS } from './risk-scanner-tools';
// Geo SOTA 2026-05-29 — 5 geo brain tools surfacing the geofencing
// service. See Docs/RESEARCH/GEO_SOTA_2026-05-29.md §6 and
// services/api-gateway/src/composition/brain-tools/geo-tools.ts.
import { GEO_TOOLS } from './geo-tools';
// Chat-everywhere CE-1 2026-05-29 — 6 tools closing the chat-action
// coverage gaps identified by Docs/AUDIT/CHAT_ACTION_COVERAGE_2026-05-29.md.
// Lifts owner-cockpit coverage from 91.8% to 100% of shippable surface
// (admin / estate / payroll gaps stay sibling-owned).
import { CHAT_EVERYWHERE_TOOLS } from './chat-everywhere-tools';
// Undo-chain CE-5 2026-05-29 — undo.last_n + undo.by_id wrap the
// existing single-action /owner/undo-journal/undo-last endpoint into
// a multi-action chain. See Docs/research/CHAT_HANDLES_EVERYTHING_
// SOTA_2026-05-29.md §4.3.
import { UNDO_CHAIN_TOOLS } from './undo-chain-tools';
// Admin inviolable-rule chat tools G-FIX-5 — 8 HIGH-risk admin-only
// tools wrapping kill-switch / four-eye / policy / feature-flag /
// audit-export / tenant-suspend surfaces. Each is sovereign-prefixed
// and `requiresPolicyRuleLiteral: true` per CLAUDE.md hard rule.
import { ADMIN_INVIOLABLE_TOOLS } from './admin-inviolable-tools';
// Capability disclosure CSA-3 + CSA-4 2026-05-29 — two LOW-stakes
// read-only tools (`mwikila.capabilities.what_can_you_do`,
// `mwikila.about`) that surface the canonical capability registry from
// @borjie/persona-runtime as USER-OUTCOME narrative answers. Owner can
// ask "what can you do" / "are you AI" / "how does this work" without
// the brain leaking internal architecture. See Docs/AUDIT/
// CAPABILITY_DISCLOSURE_PATTERNS.md for the 15 vetted dialogue patterns.
import { CAPABILITY_TOOLS } from './capability-tools';
// Jurisdiction-discovery JC-1 + JC-6 — Mr. Mwikila NEVER says
// "I don't know" about a country. `mwikila.jurisdiction.discover`
// runs the on-demand pipeline (seed → cache → web+corpus probes) and
// `mwikila.jurisdiction.switch` lets the brain apply a per-turn or
// per-session override — but NEVER permanent (tenant.jurisdiction is
// LOCKED at signup; only Borjie internal admin can change it via the
// JC-7 four-eye route).
import { JURISDICTION_DISCOVERY_TOOLS } from './jurisdiction-discovery-tools';
// Jurisdiction JA-4 — `mwikila.jurisdiction.show_current` returns the
// tenant's current jurisdiction snapshot + bilingual offer to switch
// context. Companion to JC's `mwikila.jurisdiction.discover` (unseeded
// path) and `mwikila.jurisdiction.switch` (turn / session override).
import { JURISDICTION_TOOLS } from './jurisdiction-tools';
// Real-time reasoning RT-7 — `mwikila.reason.strategize` returns a
// structured StrategyTrace (current state prompt, constraints,
// 2-4 strategies with pros/cons/confidence, recommended_index, why,
// downsides, retrospective grade plan). The chat turn uses it as
// CONTEXT — the model composes the narrative reply itself. Available
// to T1 owner / T2 admin / T3 manager.
import { REASON_STRATEGIZE_TOOLS } from './reason-strategize-tool';

export type AnyPersonaToolDescriptor = PersonaToolDescriptor<
  z.ZodTypeAny,
  z.ZodTypeAny
>;

export interface BuildPersonaToolHandlersOptions {
  /**
   * Invoked when the same tool id appears in more than one source list.
   * Defaults to a no-op so production boot stays silent; tests can hook
   * the callback to fail loudly.
   */
  readonly onDuplicate?: (toolId: string) => void;
  /** Optional `now()` injection for deterministic audit timestamps. */
  readonly now?: () => string;
}

/**
 * Build the complete, deduplicated list of persona-aware brain
 * tool handlers. The returned array is frozen so callers can rely on
 * stable identity across registrations.
 */
export function buildPersonaToolHandlers(
  gate: PersonaToolGate,
  options?: BuildPersonaToolHandlersOptions,
): ReadonlyArray<ToolHandler> {
  const merged = mergeDescriptors(
    [
      SHARED_TOOLS,
      OWNER_TOOLS,
      OWNER_ESTATE_TOOLS,
      MANAGER_TOOLS,
      WORKER_TOOLS,
      BUYER_TOOLS,
      ADMIN_TOOLS,
      SCOPE_TOOLS,
      MD_INTELLIGENCE_TOOLS,
      WORKFORCE_CLOCK_IN_TOOLS,
      MINING_PRODUCTION_TOOLS,
      COOPERATIVE_TOOLS,
      INSURANCE_TOOLS,
      OWNER_MESSAGING_TOOLS,
      OWNER_SAVED_SEARCH_TOOLS,
      SUPERPOWERS_TOOLS,
      DECISION_JOURNAL_TOOLS,
      ENTITY_LEGIBILITY_TOOLS,
      OPPORTUNITY_SCANNER_TOOLS,
      RISK_SCANNER_TOOLS,
      GEO_TOOLS,
      CHAT_EVERYWHERE_TOOLS,
      UNDO_CHAIN_TOOLS,
      ADMIN_INVIOLABLE_TOOLS,
      CAPABILITY_TOOLS,
      JURISDICTION_DISCOVERY_TOOLS,
      JURISDICTION_TOOLS,
      REASON_STRATEGIZE_TOOLS,
    ],
    options?.onDuplicate,
  );

  // Kill-switch fail-closed: when the switch is open we return an empty
  // catalog so the brain has nothing to call. The per-tool execute hook
  // also refuses for defense in depth, but starting from `[]` makes the
  // intent unambiguous to every downstream consumer (tests, UI counters,
  // metrics).
  if (gate.killSwitchOpen) {
    return Object.freeze([]);
  }

  const handlers = merged.map((descriptor) =>
    toBrainToolHandler(descriptor, gate, {
      ...(options?.now !== undefined && { now: options.now }),
    }),
  );
  return Object.freeze(handlers);
}

/**
 * Return the unwrapped descriptor list — useful for tests / catalog
 * audits that need access to the persona metadata before the orchestrator
 * adapter wraps them.
 */
export function listPersonaToolDescriptors(): ReadonlyArray<AnyPersonaToolDescriptor> {
  return mergeDescriptors(
    [
      SHARED_TOOLS,
      OWNER_TOOLS,
      OWNER_ESTATE_TOOLS,
      MANAGER_TOOLS,
      WORKER_TOOLS,
      BUYER_TOOLS,
      ADMIN_TOOLS,
      SCOPE_TOOLS,
      MD_INTELLIGENCE_TOOLS,
      WORKFORCE_CLOCK_IN_TOOLS,
      MINING_PRODUCTION_TOOLS,
      COOPERATIVE_TOOLS,
      INSURANCE_TOOLS,
      OWNER_MESSAGING_TOOLS,
      OWNER_SAVED_SEARCH_TOOLS,
      SUPERPOWERS_TOOLS,
      DECISION_JOURNAL_TOOLS,
      ENTITY_LEGIBILITY_TOOLS,
      OPPORTUNITY_SCANNER_TOOLS,
      RISK_SCANNER_TOOLS,
      GEO_TOOLS,
      CHAT_EVERYWHERE_TOOLS,
      UNDO_CHAIN_TOOLS,
      ADMIN_INVIOLABLE_TOOLS,
      CAPABILITY_TOOLS,
      JURISDICTION_DISCOVERY_TOOLS,
      JURISDICTION_TOOLS,
      REASON_STRATEGIZE_TOOLS,
    ],
    undefined,
  );
}

function mergeDescriptors(
  lists: ReadonlyArray<ReadonlyArray<AnyPersonaToolDescriptor>>,
  onDuplicate: ((toolId: string) => void) | undefined,
): ReadonlyArray<AnyPersonaToolDescriptor> {
  const seen = new Set<string>();
  const out: AnyPersonaToolDescriptor[] = [];
  for (const list of lists) {
    for (const descriptor of list) {
      if (seen.has(descriptor.id)) {
        onDuplicate?.(descriptor.id);
        continue;
      }
      seen.add(descriptor.id);
      out.push(descriptor);
    }
  }
  return Object.freeze(out);
}

// Re-export for ergonomic imports from `brain-extensions.ts`.
export {
  toBrainToolHandler,
  type PersonaToolDescriptor,
  type PersonaToolGate,
  type PersonaToolHandlerContext,
  type PersonaToolAuditSink,
  type PersonaToolAuditEntry,
  type PersonaToolHttpClient,
  PERSONA_SLUGS,
} from './types';
export { SHARED_TOOLS } from './shared-tools';
export { OWNER_TOOLS } from './owner-tools';
export { OWNER_ESTATE_TOOLS } from './owner-estate-tools';
export { MANAGER_TOOLS } from './manager-tools';
export { WORKER_TOOLS } from './worker-tools';
export { BUYER_TOOLS } from './buyer-tools';
export { ADMIN_TOOLS } from './admin-tools';
export { SCOPE_TOOLS } from './scope-tools';
export { MD_INTELLIGENCE_TOOLS } from './md-intelligence-tools';
export { WORKFORCE_CLOCK_IN_TOOLS } from './workforce-clock-in-tools';
export { MINING_PRODUCTION_TOOLS } from './mining-production-tools';
export { COOPERATIVE_TOOLS } from './cooperative-tools';
export { INSURANCE_TOOLS } from './insurance-tools';
export { OWNER_MESSAGING_TOOLS } from './owner-messaging-tools';
export {
  OWNER_SAVED_SEARCH_TOOLS,
  ownerSavedSearchCreateTool,
} from './owner-saved-search-tools';
export { SUPERPOWERS_TOOLS } from './superpowers-tools';
export {
  DECISION_JOURNAL_TOOLS,
  configureDecisionJournalTools,
} from './decision-journal-tools';
export { ENTITY_LEGIBILITY_TOOLS } from './entity-legibility-tools';
export {
  OPPORTUNITY_SCANNER_TOOLS,
  configureOpportunityScannerTools,
} from './opportunity-scanner-tools';
export {
  RISK_SCANNER_TOOLS,
  configureRiskScannerTools,
} from './risk-scanner-tools';
// Geo SOTA 2026-05-29 — re-export for ergonomic imports.
export { GEO_TOOLS } from './geo-tools';
// Chat-everywhere CE-1 2026-05-29 — re-export for ergonomic imports
// (test harnesses + audit walker).
export {
  CHAT_EVERYWHERE_TOOLS,
  uiPinTabTool,
  uiReorderTabTool,
  uiRemoveTabTool,
  uiExportPdfTool,
  uiMarkNotificationReadTool,
  ownerConnectedAgentRevokeTool,
} from './chat-everywhere-tools';
// Undo-chain CE-5 2026-05-29 — re-exports.
export {
  UNDO_CHAIN_TOOLS,
  undoLastNTool,
  undoByIdTool,
} from './undo-chain-tools';
// Admin inviolable-rule G-FIX-5 — re-exports for tests + audit walker.
export {
  ADMIN_INVIOLABLE_TOOLS,
  adminKillSwitchOpenTool,
  adminKillSwitchCloseTool,
  adminFourEyeInitiateTool,
  adminFourEyeApproveTool,
  adminPolicyEditRuleTool,
  adminFeatureFlagSetTool,
  adminAuditExportTool,
  adminTenantSuspendTool,
} from './admin-inviolable-tools';
// Capability disclosure CSA-3 + CSA-4 — re-exports for tests + audit walker.
export {
  CAPABILITY_TOOLS,
  whatCanYouDoTool,
  aboutTool,
} from './capability-tools';
// Jurisdiction JA-4 — re-exports for tests + audit walker.
export {
  JURISDICTION_TOOLS,
  jurisdictionShowCurrentTool,
} from './jurisdiction-tools';
// RT-7 — re-exports for tests + audit walker.
export {
  REASON_STRATEGIZE_TOOLS,
  reasonStrategizeTool,
} from './reason-strategize-tool';
