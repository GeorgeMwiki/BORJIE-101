/**
 * Tests for Ms. Sifa's `JuniorPersona` value + her seed recipes.
 *
 * These tests are the proof-of-concept for the Wave 18V Junior
 * Architecture contract. Every other junior upgrade should ship the
 * same shape of test suite.
 */

import { describe, expect, it } from 'vitest';
import {
  juniorOwnsTabRecipe,
  juniorOwnsDocRecipe,
  juniorServesAudience,
  getJuniorMode,
} from '@borjie/agent-platform';
import {
  miningShiftPlannerPersona,
  shiftPlanReviewRecipe,
  crewAssignmentRecipe,
  weeklyProductionBriefRecipe,
} from '../index.js';

describe('Ms. Sifa — JuniorPersona contract', () => {
  it('declares the canonical id and display name', () => {
    expect(miningShiftPlannerPersona.id).toBe('mining-shift-planner');
    expect(miningShiftPlannerPersona.name).toBe('Ms. Sifa');
    expect(miningShiftPlannerPersona.title).toContain('Shift-Planning Specialist');
  });

  it('mandate fits inside the 150-word cap', () => {
    const word_count = miningShiftPlannerPersona.mandate
      .split(/\s+/)
      .filter(Boolean).length;
    expect(word_count).toBeLessThanOrEqual(150);
    expect(word_count).toBeGreaterThan(80);
  });

  it('ships four modes — plan, report, escalate, brief', () => {
    const ids = miningShiftPlannerPersona.modes.map((m) => m.id);
    expect(ids).toEqual(['plan', 'report', 'escalate', 'brief']);
  });

  it('every mode has sample prompts and a system prompt', () => {
    for (const mode of miningShiftPlannerPersona.modes) {
      expect(mode.sample_prompts.length).toBeGreaterThan(0);
      expect(mode.system_prompt.length).toBeGreaterThan(20);
    }
  });

  it('every mode tools_allowed is a subset of persona tools_allowed', () => {
    const top = new Set(miningShiftPlannerPersona.tools_allowed);
    for (const mode of miningShiftPlannerPersona.modes) {
      for (const tool of mode.tools_allowed) {
        expect(top.has(tool)).toBe(true);
      }
    }
  });
});

describe('Ms. Sifa — JuniorScope', () => {
  it('caps authority at tier 1 and escalates Tier 2 to the MD', () => {
    expect(miningShiftPlannerPersona.scope.authority_tier_max).toBe(1);
    expect(miningShiftPlannerPersona.scope.requires_md_for_tier_2).toBe(true);
  });

  it('owns shift_plan_review and crew_assignment tab recipes', () => {
    expect(juniorOwnsTabRecipe(miningShiftPlannerPersona, 'shift_plan_review')).toBe(true);
    expect(juniorOwnsTabRecipe(miningShiftPlannerPersona, 'crew_assignment')).toBe(true);
  });

  it('does NOT own out-of-scope recipes (e.g. buyer KYB)', () => {
    expect(juniorOwnsTabRecipe(miningShiftPlannerPersona, 'buyer_kyb_start')).toBe(false);
    expect(juniorOwnsDocRecipe(miningShiftPlannerPersona, 'monthly_osha_filing')).toBe(false);
  });

  it('owns the weekly production brief doc recipe', () => {
    expect(juniorOwnsDocRecipe(miningShiftPlannerPersona, 'weekly_production_brief')).toBe(true);
  });

  it('declares production-domain data_tables only', () => {
    const tables = miningShiftPlannerPersona.scope.data_tables;
    expect(tables).toContain('shift_plans');
    expect(tables).toContain('site_polygons');
    expect(tables).toContain('assets_fleet');
    expect(tables).not.toContain('treasury_positions');
    expect(tables).not.toContain('buyer_kyc_records');
  });
});

describe('Ms. Sifa — target audiences + escalation', () => {
  it('serves manager and employee audiences only', () => {
    expect(juniorServesAudience(miningShiftPlannerPersona, 'manager')).toBe(true);
    expect(juniorServesAudience(miningShiftPlannerPersona, 'employee')).toBe(true);
  });

  it('does NOT serve owner or customer directly', () => {
    expect(juniorServesAudience(miningShiftPlannerPersona, 'owner')).toBe(false);
    expect(juniorServesAudience(miningShiftPlannerPersona, 'customer')).toBe(false);
  });

  it('escalates above tier 1, on cross-domain, and on low confidence', () => {
    const e = miningShiftPlannerPersona.mr_mwikila_escalation;
    expect(e.auto_escalate_above_authority_tier).toBe(1);
    expect(e.auto_escalate_on_cross_domain).toBe(true);
    expect(e.auto_escalate_on_low_confidence).toBe(true);
    expect(e.hand_off_transcript_to_mr_mwikila).toBe(true);
  });
});

describe('getJuniorMode — Ms. Sifa', () => {
  it('returns the named mode', () => {
    const mode = getJuniorMode(miningShiftPlannerPersona, 'plan');
    expect(mode?.id).toBe('plan');
    expect(mode?.name).toBe('Plan');
  });

  it('returns null for unknown modes', () => {
    expect(getJuniorMode(miningShiftPlannerPersona, 'hedge-propose')).toBeNull();
  });
});

describe('Ms. Sifa — recipe descriptors', () => {
  it('shift_plan_review is a live brand-locked tier-1 tab recipe', () => {
    expect(shiftPlanReviewRecipe.id).toBe('shift_plan_review');
    expect(shiftPlanReviewRecipe.brand).toBe('borjie');
    expect(shiftPlanReviewRecipe.status).toBe('live');
    expect(shiftPlanReviewRecipe.authority_tier).toBe(1);
    expect(shiftPlanReviewRecipe.data_sources).toContain('shift_plans');
  });

  it('crew_assignment is a live brand-locked tier-1 tab recipe', () => {
    expect(crewAssignmentRecipe.id).toBe('crew_assignment');
    expect(crewAssignmentRecipe.brand).toBe('borjie');
    expect(crewAssignmentRecipe.authority_tier).toBe(1);
  });

  it('weekly_production_brief is an approval-gated multi-format doc recipe', () => {
    expect(weeklyProductionBriefRecipe.id).toBe('weekly_production_brief');
    expect(weeklyProductionBriefRecipe.owner_gate).toBe('approval');
    expect(weeklyProductionBriefRecipe.outputs).toEqual(['pdf', 'docx', 'md']);
    expect(weeklyProductionBriefRecipe.data_sources).toContain('shift_plans');
  });

  it('every recipe id appears in the persona scope', () => {
    expect(
      miningShiftPlannerPersona.scope.tab_recipes_owned,
    ).toContain(shiftPlanReviewRecipe.id);
    expect(
      miningShiftPlannerPersona.scope.tab_recipes_owned,
    ).toContain(crewAssignmentRecipe.id);
    expect(
      miningShiftPlannerPersona.scope.doc_recipes_owned,
    ).toContain(weeklyProductionBriefRecipe.id);
  });
});
