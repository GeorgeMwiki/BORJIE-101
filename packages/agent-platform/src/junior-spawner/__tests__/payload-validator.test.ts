/**
 * payload-validator.test.ts — Wave 18V-DYNAMIC.
 *
 * Asserts every JuniorPersona invariant is enforced:
 *   - agent_id must be kebab-case
 *   - subtitle must start with "Borjie's AI"
 *   - at least one mode
 *   - non-empty audiences from the canonical set
 *   - authority_tier_max in {0, 1, 2}
 *   - llm_reasoning non-empty
 */

import { describe, expect, it } from 'vitest';
import { validateSpawnedJuniorPayload } from '../spawn/payload-validator.js';

function basePayload() {
  return {
    proposed_agent_id: 'drone-imagery-analyst',
    proposed_specialisation: 'Drone Imagery Analysis',
    proposed_subtitle: "Borjie's AI Drone Imagery Specialist",
    proposed_scope: {
      data_tables: ['imagery_uploads'],
      tab_recipes_owned: [],
      doc_recipes_owned: [],
      media_recipes_owned: [],
      research_topics: ['drone', 'imagery'],
      authority_tier_max: 1,
      requires_md_for_tier_2: true,
    },
    proposed_modes: [
      {
        id: 'analyse',
        name: 'Analyse',
        mandate: 'Analyse drone imagery for safety indicators.',
        sample_prompts: ['Review yesterday’s flight'],
        tools_allowed: ['compose_anything_v1'],
        system_prompt: 'You are Mr. Mwikila, the imagery analyst.',
      },
    ],
    proposed_escalation_policy: {
      auto_escalate_above_authority_tier: 1,
      auto_escalate_on_cross_domain: true,
      auto_escalate_on_low_confidence: true,
      hand_off_transcript_to_mr_mwikila: true,
    },
    proposed_audiences: ['manager', 'admin'],
    proposed_authority_tier_max: 1,
    llm_reasoning: 'The user asked about drone imagery and no seed serves this intent.',
  };
}

describe('validateSpawnedJuniorPayload', () => {
  it('accepts a well-formed payload', () => {
    const result = validateSpawnedJuniorPayload(basePayload());
    expect(result.ok).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = validateSpawnedJuniorPayload(null);
    expect(result.ok).toBe(false);
  });

  it('rejects non-kebab-case agent_id', () => {
    const result = validateSpawnedJuniorPayload({
      ...basePayload(),
      proposed_agent_id: 'DroneImageryAnalyst',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('kebab-case'))).toBe(true);
    }
  });

  it('rejects subtitle without "Borjie\'s AI" prefix', () => {
    const result = validateSpawnedJuniorPayload({
      ...basePayload(),
      proposed_subtitle: 'Drone Imagery Specialist',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects zero modes', () => {
    const result = validateSpawnedJuniorPayload({
      ...basePayload(),
      proposed_modes: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects empty audience list', () => {
    const result = validateSpawnedJuniorPayload({
      ...basePayload(),
      proposed_audiences: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown audience', () => {
    const result = validateSpawnedJuniorPayload({
      ...basePayload(),
      proposed_audiences: ['root'],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects authority_tier_max outside {0,1,2}', () => {
    const result = validateSpawnedJuniorPayload({
      ...basePayload(),
      proposed_authority_tier_max: 3,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects empty llm_reasoning', () => {
    const result = validateSpawnedJuniorPayload({
      ...basePayload(),
      llm_reasoning: '',
    });
    expect(result.ok).toBe(false);
  });
});
