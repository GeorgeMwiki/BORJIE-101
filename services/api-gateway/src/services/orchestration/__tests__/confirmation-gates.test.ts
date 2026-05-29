/**
 * confirmation-gates tests — CE-4 invariant verification.
 *
 * The CE-4 contract:
 *
 *   Every HIGH-stakes write tool in the brain catalog must classify
 *   as `risk-tier=high` via `resolveRiskTier`. Otherwise a chat-
 *   initiated mutation could fire without the visual two-tap
 *   confirmation card, breaking the inviolable CLAUDE.md rule:
 *
 *     "HIGH-risk policy prefixes (sovereign / kill_switch / four_eye
 *      / policy_rollout) must hit literal policy rules; no reason-
 *      resolver generalisation."
 *
 * Similarly the orchestration runner's `applyRiskTierPolicy` then
 * fills `humanCheckpoint: 'two-tap'` on every high-tier step. This
 * test walks every WRITE descriptor in the catalog and asserts the
 * mapping is consistent.
 */

import { describe, it, expect } from 'vitest';
import { listPersonaToolDescriptors } from '../../../composition/brain-tools/index.js';
import { applyRiskTierPolicy, type PlanDag } from '../plan-dag.js';
import { resolveRiskTier } from '../risk-tiers.js';

const ALL = listPersonaToolDescriptors();
const WRITES = ALL.filter((t) => t.isWrite === true);

describe('CE-4 confirmation gates — descriptor stakes ↔ resolveRiskTier', () => {
  it('catalog has at least 30 WRITE tools (regression alarm)', () => {
    expect(WRITES.length).toBeGreaterThanOrEqual(30);
  });

  it('every HIGH-stakes WRITE tool classifies as risk-tier=high', () => {
    const mismatches: Array<{ id: string; tier: string }> = [];
    for (const tool of WRITES) {
      if (tool.stakes !== 'HIGH') continue;
      const tier = resolveRiskTier(tool.id);
      if (tier !== 'high') mismatches.push({ id: tool.id, tier });
    }
    if (mismatches.length > 0) {
      const msg = mismatches.map((m) => `${m.id}=${m.tier}`).join(', ');
      throw new Error(
        `${mismatches.length} HIGH-stakes WRITE tools missing high risk-tier rule: ${msg}`,
      );
    }
  });

  it('every tool with requiresPolicyRuleLiteral=true classifies as high', () => {
    const mismatches: string[] = [];
    for (const tool of WRITES) {
      if (!tool.requiresPolicyRuleLiteral) continue;
      if (resolveRiskTier(tool.id) !== 'high') mismatches.push(tool.id);
    }
    expect(mismatches).toEqual([]);
  });

  it('every kill_switch.* and four_eye.* tool classifies as high (defense in depth)', () => {
    const violations: string[] = [];
    for (const tool of ALL) {
      if (
        tool.id.startsWith('kill_switch.') ||
        tool.id.startsWith('four_eye.') ||
        tool.id.startsWith('sovereign.') ||
        tool.id.startsWith('policy_rollout.')
      ) {
        if (resolveRiskTier(tool.id) !== 'high') violations.push(tool.id);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('CE-4 plan-runner default-checkpoint contract', () => {
  it('applyRiskTierPolicy assigns two-tap to every high-tier step', () => {
    const plan: PlanDag = {
      planId: 'p',
      intent: 't',
      steps: [
        {
          id: 'high1',
          toolId: 'kill_switch.open',
          input: {},
          riskTier: 'high',
          evidenceIds: [],
          labelEn: 'h',
          labelSw: 'h',
        },
        {
          id: 'med1',
          toolId: 'mining.production.log_tonnage',
          input: {},
          riskTier: 'medium',
          evidenceIds: [],
          labelEn: 'm',
          labelSw: 'm',
        },
        {
          id: 'low1',
          toolId: 'mining.ui.navigate',
          input: {},
          riskTier: 'low',
          evidenceIds: [],
          labelEn: 'l',
          labelSw: 'l',
        },
      ],
      edges: [],
    };
    const updated = applyRiskTierPolicy(plan);
    expect(
      updated.steps.find((s) => s.id === 'high1')!.humanCheckpoint,
    ).toBe('two-tap');
    expect(
      updated.steps.find((s) => s.id === 'med1')!.humanCheckpoint,
    ).toBe('preview');
    expect(
      updated.steps.find((s) => s.id === 'low1')!.humanCheckpoint,
    ).toBeUndefined();
  });
});
