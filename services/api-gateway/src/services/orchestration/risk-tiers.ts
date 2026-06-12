/**
 * Risk Tiers — CE-4 confirmation-gate source of truth.
 *
 * Maps every brain-tool id prefix to a `RiskTier`. The plan-runner
 * consults this when filling in `humanCheckpoint` defaults via
 * `applyRiskTierPolicy` in `plan-dag.ts`. Chat-initiated mutations
 * route through the same table so chat-mode and form-mode behave
 * identically.
 *
 * Mapping rationale (anchored to CLAUDE.md hard rules):
 *
 *   HIGH (two-tap confirm + literal policy rule on the gate):
 *     - kill_switch.*    — sovereign safety primitive
 *     - four_eye.*       — dual-approver-required by inviolable
 *     - sovereign.*      — owner-only sovereign actions
 *     - policy_rollout.* — fleetwide policy mutation
 *     - owner.connected_agents.revoke — auth-surface destructive
 *
 *   MEDIUM (preview before fire):
 *     - mining.production.*, treasury.ledger.*  — financial writes
 *     - owner.rfb.dispatch_to_manager           — downstream notify
 *     - cooperative.draft_settlement            — multi-member payout
 *     - mining.escalations.*                    — chain-of-command
 *     - mining.ui.{pin,reorder,remove}_tab      — cockpit layout
 *
 *   LOW (autonomous — fire without prompt):
 *     - all `.search`, `.list`, `.inspect`, `.recent`, `.status`
 *     - cockpit reads (cockpit.* read tools)
 *     - mining.ui.{navigate, highlight, export_pdf}
 *     - decisions.{explain, replay, search} read tools
 *
 * Discipline:
 *   - Pure data table + one lookup function. No I/O.
 *   - Exhaustive — every prefix listed must classify into exactly
 *     one tier (no overlap; longest-prefix wins).
 *   - Defensive default = HIGH so an un-classified tool is never
 *     fired without confirmation (fail-closed per CLAUDE.md).
 */

import type { RiskTier } from './plan-dag';

interface TierRule {
  readonly prefix: string;
  readonly tier: RiskTier;
}

const RULES: ReadonlyArray<TierRule> = Object.freeze([
  // ── HIGH (two-tap confirm) ────────────────────────────────────────
  { prefix: 'kill_switch.', tier: 'high' },
  { prefix: 'four_eye.', tier: 'high' },
  { prefix: 'sovereign.', tier: 'high' },
  { prefix: 'policy_rollout.', tier: 'high' },
  { prefix: 'owner.connected_agents.revoke', tier: 'high' },
  { prefix: 'admin.kill-switch.', tier: 'high' },
  { prefix: 'admin.killswitch.', tier: 'high' },
  { prefix: 'admin.four_eye.', tier: 'high' },
  { prefix: 'admin.feature_flag.set', tier: 'high' },
  { prefix: 'admin.policy.edit_rule', tier: 'high' },
  { prefix: 'admin.tenant.suspend', tier: 'high' },
  { prefix: 'owner.regulator.approve_disclosure', tier: 'high' },
  { prefix: 'owner.licence.submit_renewal', tier: 'high' },
  { prefix: 'owner.inspection.sign', tier: 'high' },
  { prefix: 'buyer.delivery.sign', tier: 'high' },
  { prefix: 'cooperative.draft_settlement', tier: 'high' },
  { prefix: 'insurance.bind_policy', tier: 'high' },
  { prefix: 'mining.ui.bulk_action', tier: 'high' },
  // Admin superpowers — four-eye / fleetwide bulk writes (stakes: HIGH).
  { prefix: 'admin.superpowers.bulk_action', tier: 'high' },
  { prefix: 'admin.superpowers.approve', tier: 'high' },
  { prefix: 'admin.superpowers.reject', tier: 'high' },
  // Site damage settlement + rehabilitation — financial / claim-state moves.
  { prefix: 'site.damage_claim.settle', tier: 'high' },
  { prefix: 'site.damage_claim.respond', tier: 'high' },
  { prefix: 'site.rehabilitation.approve_plan', tier: 'high' },
  // Org-team — human escalation + irreversible bulk staff ingest.
  { prefix: 'staff.escalate_to_human', tier: 'high' },
  { prefix: 'staff.bulk_ingest_csv', tier: 'high' },
  // MD agentic sandbox — commit lands a staged mutation on the real table.
  { prefix: 'sandbox.commit', tier: 'high' },
  // Legacy-portal browser super-power — drives an external regulator portal
  // and submits a real filing (requiresPolicyRuleLiteral on the descriptor).
  { prefix: 'platform.legacy.', tier: 'high' },
  // Integration fabric — invoking an external SaaS is an EGRESS WRITE
  // (requiresPolicyRuleLiteral on the descriptor). Two-tap confirm.
  { prefix: 'integration.connector.invoke', tier: 'high' },
  // Jurisdiction promote — sovereign-grade launch-market mutation; must
  // out-prefix the blanket `mwikila.` low rule (longest-prefix wins).
  { prefix: 'mwikila.jurisdiction.promote', tier: 'high' },
  // Jurisdiction compliance learn-feed — writes into the SHARED (tenant_id
  // NULL) corpus every tenant inherits; sovereign-grade, policy-literal.
  // Same longest-prefix carve-out from the blanket `mwikila.` low rule.
  { prefix: 'mwikila.jurisdiction.ingest_compliance', tier: 'high' },

  // ── MEDIUM (preview) ─────────────────────────────────────────────
  { prefix: 'mining.production.', tier: 'medium' },
  { prefix: 'treasury.ledger.', tier: 'medium' },
  { prefix: 'owner.rfb.dispatch_to_manager', tier: 'medium' },
  { prefix: 'manager.task.assign_worker', tier: 'medium' },
  { prefix: 'mining.tasks.assign', tier: 'medium' },
  { prefix: 'mining.tasks.complete', tier: 'medium' },
  { prefix: 'mining.approvals.decide', tier: 'medium' },
  { prefix: 'mining.escalations.', tier: 'medium' },
  { prefix: 'mining.incidents.report', tier: 'medium' },
  { prefix: 'mining.bids.place', tier: 'medium' },
  { prefix: 'mining.bids.cancel', tier: 'medium' },
  { prefix: 'mining.marketplace.accept-offer', tier: 'medium' },
  { prefix: 'mining.attendance.clock-', tier: 'medium' },
  { prefix: 'mining.workforce.log-fuel', tier: 'medium' },
  { prefix: 'mining.samples.submit', tier: 'medium' },
  { prefix: 'mining.geology.log-drill-hole', tier: 'medium' },
  { prefix: 'mining.shift-reports.draft', tier: 'medium' },
  { prefix: 'mining.toolbox-talks.acknowledge', tier: 'medium' },
  { prefix: 'mining.buyers.kyc.upload-atom', tier: 'medium' },
  { prefix: 'mining.ui.pin_tab', tier: 'medium' },
  { prefix: 'mining.ui.reorder_tab', tier: 'medium' },
  { prefix: 'mining.ui.remove_tab', tier: 'medium' },
  { prefix: 'mining.ui.prefill_form', tier: 'medium' },
  // `mining.ui.bulk_action` carries `requiresPolicyRuleLiteral=true`
  // per superpowers-tools.ts; CE-4 invariant promotes it to high so
  // the literal policy rule fires and a two-tap confirmation card
  // surfaces before any bulk write executes.
  { prefix: 'mining.ui.share_view', tier: 'medium' },
  { prefix: 'mining.ui.bookmark', tier: 'medium' },
  { prefix: 'mining.ui.unbookmark', tier: 'medium' },
  { prefix: 'mining.ui.undo_last_action', tier: 'medium' },
  { prefix: 'undo.last_n', tier: 'medium' },
  { prefix: 'undo.by_id', tier: 'medium' },
  { prefix: 'owner.drafter.lock', tier: 'medium' },
  { prefix: 'owner.licence.start_renewal', tier: 'medium' },
  { prefix: 'owner.messaging.send_to', tier: 'medium' },
  { prefix: 'owner.saved_search.create', tier: 'medium' },
  { prefix: 'ops.engagements.log', tier: 'medium' },
  { prefix: 'buyer.rfb.create', tier: 'medium' },
  { prefix: 'admin.regulator.create_request', tier: 'medium' },
  { prefix: 'manager.inspection.generate_narrative', tier: 'medium' },
  { prefix: 'insurance.get_quotes', tier: 'medium' },
  { prefix: 'documents.upload', tier: 'medium' },
  { prefix: 'ops.parties.create', tier: 'medium' },
  // Owner cockpit dynamic tabs — routine layout/content writes.
  { prefix: 'mining.ui.tabs.spawn', tier: 'medium' },
  { prefix: 'mining.ui.tabs.close', tier: 'medium' },
  { prefix: 'mining.ui.tabs.update', tier: 'medium' },
  // Org-team — routine staff record / KPI / task writes.
  { prefix: 'staff.create', tier: 'medium' },
  { prefix: 'staff.assign_kpi', tier: 'medium' },
  { prefix: 'staff.schedule_task', tier: 'medium' },
  // MD agentic plan — propose + dispatch (runs persist pending; reversible).
  { prefix: 'plan.propose', tier: 'medium' },
  { prefix: 'plan.dispatch_subagents', tier: 'medium' },
  // MD agentic sandbox — stage / reject a write (real table NEVER touched).
  { prefix: 'sandbox.write', tier: 'medium' },
  { prefix: 'sandbox.reject', tier: 'medium' },

  // ── LOW (autonomous read / navigate / display) ───────────────────
  { prefix: 'mining.ui.navigate', tier: 'low' },
  { prefix: 'mining.ui.highlight', tier: 'low' },
  { prefix: 'mining.ui.export_pdf', tier: 'low' },
  { prefix: 'mining.ui.mark_notification_read', tier: 'low' },
  { prefix: 'mining.cockpit.', tier: 'low' },
  { prefix: 'mining.reports.list', tier: 'low' },
  { prefix: 'documents.search', tier: 'low' },
  { prefix: 'decisions.explain', tier: 'low' },
  { prefix: 'decisions.recent', tier: 'low' },
  { prefix: 'decisions.search', tier: 'low' },
  { prefix: 'decisions.replay', tier: 'low' },
  { prefix: 'decisions.what_did_i_decide', tier: 'low' },
  { prefix: 'decisions.success_rate', tier: 'low' },
  { prefix: 'borjie.ask', tier: 'low' },
  { prefix: 'borjie.cite', tier: 'low' },
  { prefix: 'entity.', tier: 'low' },
  { prefix: 'estate.', tier: 'low' },
  { prefix: 'ops.chain_of_custody.track', tier: 'low' },
  { prefix: 'ops.regulatory_filings.next_due', tier: 'low' },
  { prefix: 'ops.external_parties.lookup', tier: 'low' },
  { prefix: 'scope.', tier: 'low' },
  { prefix: 'md.', tier: 'low' },
  { prefix: 'mining.geo.', tier: 'low' },
  { prefix: 'mining.opportunities.scan', tier: 'low' },
  { prefix: 'mining.opportunities.list_rules', tier: 'low' },
  { prefix: 'mining.risks.scan', tier: 'low' },
  { prefix: 'mining.risks.list_rules', tier: 'low' },
  { prefix: 'mining.licences.health', tier: 'low' },
  { prefix: 'mining.incidents.exceptions', tier: 'low' },
  { prefix: 'mining.incidents.high', tier: 'low' },
  { prefix: 'mining.tasks.list-site', tier: 'low' },
  { prefix: 'mining.tasks.mine', tier: 'low' },
  { prefix: 'mining.tasks.suggest-assignee', tier: 'low' },
  { prefix: 'mining.approvals.queue', tier: 'low' },
  { prefix: 'mining.attendance.crew', tier: 'low' },
  { prefix: 'mining.attendance.my-shift', tier: 'low' },
  { prefix: 'mining.workforce.my-crew', tier: 'low' },
  { prefix: 'mining.workforce.shift-attendance', tier: 'low' },
  { prefix: 'mining.bids.mine', tier: 'low' },
  { prefix: 'mining.marketplace.search', tier: 'low' },
  { prefix: 'mining.marketplace.listing-detail', tier: 'low' },
  { prefix: 'mining.marketplace.market-intel', tier: 'low' },
  { prefix: 'mining.marketplace.chain-of-custody', tier: 'low' },
  { prefix: 'mining.marketplace.bids-on-my-parcels', tier: 'low' },
  { prefix: 'mining.buyers.kyc.status', tier: 'low' },
  { prefix: 'mining.toolbox-talks.today', tier: 'low' },
  { prefix: 'mining.production.daily_summary', tier: 'low' },
  { prefix: 'mining.production.qa_backlog', tier: 'low' },
  { prefix: 'owner.messaging.thread_list', tier: 'low' },
  { prefix: 'owner.messaging.unread_count', tier: 'low' },
  { prefix: 'owner.settlement.list_mine', tier: 'low' },
  { prefix: 'buyer.rfb.list_mine', tier: 'low' },
  { prefix: 'seller.rfb.list_nearby', tier: 'low' },
  { prefix: 'workforce.', tier: 'low' },
  { prefix: 'cooperative.settlement_period_list', tier: 'low' },
  { prefix: 'cooperative.member_share', tier: 'low' },
  { prefix: 'insurance.policy_status', tier: 'low' },
  { prefix: 'insurance.renewals_due', tier: 'low' },
  { prefix: 'admin.audit-trail.search', tier: 'low' },
  { prefix: 'admin.corpus.recent-ingests', tier: 'low' },
  { prefix: 'admin.feature-flags.list', tier: 'low' },
  { prefix: 'admin.kill-switch.status', tier: 'low' },
  { prefix: 'admin.pilot-errors.recent', tier: 'low' },
  { prefix: 'admin.tenants.list-recent', tier: 'low' },
  { prefix: 'admin.audit.export', tier: 'high' },
  { prefix: 'buyer.notifications.mark_read', tier: 'low' },
  { prefix: 'mwikila.', tier: 'low' },
  // Integration fabric — catalog + connection-state read (isWrite:false).
  { prefix: 'integration.connector.list', tier: 'low' },
  // Mint a provider authorize URL — returns ONLY a link the owner opens and
  // approves themselves (consent + token exchange + storage happen outside
  // the brain). Descriptor: stakes LOW, isWrite:false, no policy literal.
  { prefix: 'integration.connector.connect_start', tier: 'low' },
  // Read-only review queues / aggregates (isWrite:false on the descriptor).
  { prefix: 'admin.superpowers.list_pending', tier: 'low' },
  { prefix: 'plan.aggregate_results', tier: 'low' },
  { prefix: 'sandbox.list', tier: 'low' },
]);

const DEFAULT_TIER: RiskTier = 'high';

/**
 * Resolve the risk tier for the given tool id. Uses longest-prefix-
 * match; unmatched ids default to HIGH (fail-closed).
 *
 * Pure function. O(N) over the rules table — fine for the catalog
 * size (~150 tools).
 */
export function resolveRiskTier(toolId: string): RiskTier {
  let best: TierRule | undefined;
  for (const rule of RULES) {
    if (!toolId.startsWith(rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) {
      best = rule;
    }
  }
  return best?.tier ?? DEFAULT_TIER;
}

/**
 * Walk the full catalog and emit a histogram of tier counts plus any
 * tools that hit the default (HIGH) — useful for the CE-4 audit
 * verification step.
 */
export function summariseRiskTiers(
  toolIds: ReadonlyArray<string>,
): {
  readonly counts: { readonly low: number; readonly medium: number; readonly high: number };
  readonly defaulted: ReadonlyArray<string>;
} {
  let low = 0;
  let medium = 0;
  let high = 0;
  const defaulted: string[] = [];
  for (const id of toolIds) {
    const tier = resolveRiskTier(id);
    if (tier === 'low') low += 1;
    else if (tier === 'medium') medium += 1;
    else high += 1;
    let matched = false;
    for (const rule of RULES) {
      if (id.startsWith(rule.prefix)) {
        matched = true;
        break;
      }
    }
    if (!matched) defaulted.push(id);
  }
  return Object.freeze({
    counts: Object.freeze({ low, medium, high }),
    defaulted: Object.freeze(defaulted),
  });
}
