/**
 * risk-tiers tests — CE-4 source of truth.
 *
 * Verifies:
 *   - HIGH prefixes (kill_switch / four_eye / sovereign /
 *     policy_rollout / connected_agents.revoke) classify high
 *   - MEDIUM (production / treasury / dispatches) classify medium
 *   - LOW (search / list / inspect / cockpit reads) classify low
 *   - Unmatched prefixes default to HIGH (fail-closed)
 *   - Longest-prefix-match wins (admin.kill-switch.status is LOW
 *     while admin.kill-switch.open would be HIGH)
 *   - summariseRiskTiers histogram is correct on the real catalog
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRiskTier,
  summariseRiskTiers,
} from '../risk-tiers.js';
import { listPersonaToolDescriptors } from '../../../composition/brain-tools/index.js';

describe('resolveRiskTier', () => {
  it.each([
    ['kill_switch.open', 'high'],
    ['four_eye.initiate', 'high'],
    ['sovereign.commit', 'high'],
    ['policy_rollout.apply', 'high'],
    ['owner.connected_agents.revoke', 'high'],
    ['owner.licence.submit_renewal', 'high'],
    ['cooperative.draft_settlement', 'high'],
  ] as const)('classifies %s as high', (toolId, expected) => {
    expect(resolveRiskTier(toolId)).toBe(expected);
  });

  it.each([
    ['mining.production.log_tonnage', 'medium'],
    ['owner.rfb.dispatch_to_manager', 'medium'],
    ['mining.approvals.decide', 'medium'],
    ['mining.escalations.raise', 'medium'],
    ['mining.ui.pin_tab', 'medium'],
    ['mining.ui.share_view', 'medium'],
    ['mining.bids.place', 'medium'],
  ] as const)('classifies %s as medium', (toolId, expected) => {
    expect(resolveRiskTier(toolId)).toBe(expected);
  });

  it.each([
    ['mining.ui.navigate', 'low'],
    ['mining.ui.export_pdf', 'low'],
    ['mining.ui.mark_notification_read', 'low'],
    ['mining.cockpit.daily-brief', 'low'],
    ['decisions.recent', 'low'],
    ['borjie.ask', 'low'],
    ['admin.kill-switch.status', 'low'],
  ] as const)('classifies %s as low', (toolId, expected) => {
    expect(resolveRiskTier(toolId)).toBe(expected);
  });

  it('defaults unknown ids to HIGH (fail-closed)', () => {
    expect(resolveRiskTier('completely_unknown_tool')).toBe('high');
    expect(resolveRiskTier('mining.unknown.future_action')).toBe('high');
  });

  it('uses longest-prefix-match (admin.kill-switch.status is low not high)', () => {
    expect(resolveRiskTier('admin.kill-switch.status')).toBe('low');
    expect(resolveRiskTier('admin.kill-switch.open')).toBe('high');
  });
});

describe('summariseRiskTiers', () => {
  it('produces a complete histogram for the real catalog', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    const summary = summariseRiskTiers(ids);
    expect(summary.counts.low + summary.counts.medium + summary.counts.high).toBe(
      ids.length,
    );
  });

  it('flags any catalog tool that defaults to HIGH (means rules are missing)', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    const summary = summariseRiskTiers(ids);
    if (summary.defaulted.length > 0) {
      // Surface the offending ids in the failure for fast triage. Note
      // some sibling-wave tools may legitimately classify HIGH; the
      // test fails iff any tool ISN'T explicitly listed in RULES.
      const message = `tools without explicit risk-tier rule (defaulting to HIGH): ${summary.defaulted.join(', ')}`;
      expect.soft(summary.defaulted, message).toEqual([]);
    }
  });
});
