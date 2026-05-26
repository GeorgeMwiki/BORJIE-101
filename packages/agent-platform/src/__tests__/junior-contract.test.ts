/**
 * Tests for junior-contract.ts — covers the audience-router stub plus
 * the per-recipe and per-audience scope helpers used by the persona-
 * runtime scope filter.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveAgentForUser,
  getJuniorMode,
  juniorOwnsTabRecipe,
  juniorOwnsDocRecipe,
  juniorOwnsMediaRecipe,
  juniorServesAudience,
  type JuniorPersona,
} from '../junior-contract.js';

/**
 * Minimal `JuniorPersona` fixture — covers every field so the helper
 * tests do not bleed assumptions into each other.
 */
function makeFixture(): JuniorPersona {
  return Object.freeze({
    id: 'fixture-junior',
    name: 'Ms. Mfano',
    title: "Borjie's AI Fixture Specialist",
    mandate: 'Stand-in junior used only for unit tests.',
    default_language: 'en',
    modes: [
      {
        id: 'plan',
        name: 'Plan',
        mandate: 'Test plan mode.',
        sample_prompts: ['plan something'],
        tools_allowed: ['compose_anything_v1'],
        system_prompt: 'You are a fixture in plan mode.',
      },
      {
        id: 'escalate',
        name: 'Escalate',
        mandate: 'Hand off to Mr. Mwikila.',
        sample_prompts: ['cross-domain request'],
        tools_allowed: ['compose_anything_v1'],
        system_prompt: 'You are a fixture handing off.',
      },
    ],
    scope: {
      data_tables: ['fixture_table'],
      tab_recipes_owned: ['fixture_tab'],
      doc_recipes_owned: ['fixture_doc'],
      media_recipes_owned: ['fixture_media'],
      research_topics: ['fixture_topic'],
      authority_tier_max: 1,
      requires_md_for_tier_2: true,
    },
    target_audiences: ['manager', 'employee'],
    tools_allowed: ['compose_anything_v1'],
    mr_mwikila_escalation: {
      auto_escalate_above_authority_tier: 1,
      auto_escalate_on_cross_domain: true,
      auto_escalate_on_low_confidence: true,
      hand_off_transcript_to_mr_mwikila: true,
    },
  });
}

describe('resolveAgentForUser', () => {
  it('routes owner to Mr. Mwikila with apex_audience reason', () => {
    expect(resolveAgentForUser('owner', null)).toEqual({
      agent_id: 'mr-mwikila',
      reason: 'apex_audience',
    });
  });

  it('routes admin to Mr. Mwikila with apex_audience reason', () => {
    expect(resolveAgentForUser('admin', 'anything')).toEqual({
      agent_id: 'mr-mwikila',
      reason: 'apex_audience',
    });
  });

  it('routes public to the public Mr. Mwikila variant', () => {
    expect(resolveAgentForUser('public', null)).toEqual({
      agent_id: 'mr-mwikila-public',
      reason: 'public_audience',
    });
  });

  it('falls back to MD for non-apex roles pending Wave 18W routing', () => {
    const roles = ['site_manager', 'worker', 'buyer', 'regulator'] as const;
    for (const role of roles) {
      const r = resolveAgentForUser(role, 'shift planning');
      expect(r.agent_id).toBe('mr-mwikila');
      expect(r.reason).toBe('fallback_to_md_pending_routing');
    }
  });
});

describe('getJuniorMode', () => {
  it('returns the mode when id matches', () => {
    const persona = makeFixture();
    const mode = getJuniorMode(persona, 'plan');
    expect(mode?.id).toBe('plan');
  });

  it('returns null when id does not match', () => {
    const persona = makeFixture();
    expect(getJuniorMode(persona, 'unknown')).toBeNull();
  });
});

describe('scope ownership helpers', () => {
  const persona = makeFixture();

  it('flags an owned tab recipe as owned', () => {
    expect(juniorOwnsTabRecipe(persona, 'fixture_tab')).toBe(true);
  });

  it('rejects an unowned tab recipe', () => {
    expect(juniorOwnsTabRecipe(persona, 'buyer_kyb_start')).toBe(false);
  });

  it('flags an owned doc recipe as owned', () => {
    expect(juniorOwnsDocRecipe(persona, 'fixture_doc')).toBe(true);
  });

  it('rejects an unowned doc recipe', () => {
    expect(juniorOwnsDocRecipe(persona, 'some_other_doc')).toBe(false);
  });

  it('flags an owned media recipe as owned', () => {
    expect(juniorOwnsMediaRecipe(persona, 'fixture_media')).toBe(true);
  });

  it('rejects an unowned media recipe', () => {
    expect(juniorOwnsMediaRecipe(persona, 'safety_hazard_image')).toBe(false);
  });
});

describe('juniorServesAudience', () => {
  const persona = makeFixture();

  it('permits a listed audience', () => {
    expect(juniorServesAudience(persona, 'manager')).toBe(true);
    expect(juniorServesAudience(persona, 'employee')).toBe(true);
  });

  it('rejects an audience not on the list', () => {
    expect(juniorServesAudience(persona, 'customer')).toBe(false);
    expect(juniorServesAudience(persona, 'regulator')).toBe(false);
    expect(juniorServesAudience(persona, 'owner')).toBe(false);
  });
});
