/**
 * spawner-llm.test.ts — Wave 18V-DYNAMIC.
 *
 * Asserts the spawn pipeline with a stubbed brain call:
 *   - well-formed LLM response → ok outcome
 *   - malformed JSON → ok=false
 *   - validation failure → ok=false
 *   - brain-call failure → ok=false with descriptive error
 *   - prompt includes the dedupe list
 */

import { describe, expect, it } from 'vitest';
import {
  buildSpawnPrompt,
  runSpawnLlmCall,
  type BrainCallFn,
} from '../spawn/spawner-llm.js';
import type { JuniorSpawnRequest } from '../types.js';

function makeRequest(): JuniorSpawnRequest {
  return {
    tenant_id: 'tenant-a',
    user_id: 'user-1',
    intent_natural_language: 'analyse drone imagery',
    research_session_handle: null,
    active_scope: {
      scope_id: 'scope-a',
      audience: 'manager',
      intent_keywords: ['drone', 'imagery'],
    },
  };
}

function validPayloadJson(): string {
  return JSON.stringify({
    proposed_agent_id: 'drone-imagery-analyst',
    proposed_specialisation: 'Drone Imagery Analysis',
    proposed_subtitle: "Borjie's AI Drone Imagery Specialist",
    proposed_scope: {
      data_tables: [],
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
        mandate: 'Analyse imagery.',
        sample_prompts: ['Review the flight'],
        tools_allowed: ['compose_anything_v1'],
        system_prompt: 'You are Mr. Mwikila.',
      },
    ],
    proposed_escalation_policy: {
      auto_escalate_above_authority_tier: 1,
      auto_escalate_on_cross_domain: true,
      auto_escalate_on_low_confidence: true,
      hand_off_transcript_to_mr_mwikila: true,
    },
    proposed_audiences: ['manager'],
    proposed_authority_tier_max: 1,
    llm_reasoning: 'No seed exists for drone imagery yet.',
  });
}

describe('buildSpawnPrompt', () => {
  it('embeds the user intent', () => {
    const prompt = buildSpawnPrompt(makeRequest(), []);
    expect(prompt).toContain('analyse drone imagery');
  });

  it('embeds the existing specialisations dedupe list', () => {
    const prompt = buildSpawnPrompt(makeRequest(), ['Shift Planning']);
    expect(prompt).toContain('Shift Planning');
  });

  it('handles empty dedupe list gracefully', () => {
    const prompt = buildSpawnPrompt(makeRequest(), []);
    expect(prompt).toContain('(no existing specialisations)');
  });

  it('mandates the Mr. Mwikila display name', () => {
    const prompt = buildSpawnPrompt(makeRequest(), []);
    expect(prompt).toContain('Mr. Mwikila');
  });
});

describe('runSpawnLlmCall', () => {
  it('returns ok with payload on a valid response', async () => {
    const brain: BrainCallFn = async () => ({
      response_text: validPayloadJson(),
      cost_usd: 0.12,
      latency_ms: 4_000,
    });
    const outcome = await runSpawnLlmCall(makeRequest(), [], brain);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.payload.proposed_agent_id).toBe('drone-imagery-analyst');
      expect(outcome.cost_usd).toBeCloseTo(0.12, 5);
    }
  });

  it('returns ok=false on invalid JSON', async () => {
    const brain: BrainCallFn = async () => ({
      response_text: 'not json',
      cost_usd: 0,
      latency_ms: 100,
    });
    const outcome = await runSpawnLlmCall(makeRequest(), [], brain);
    expect(outcome.ok).toBe(false);
  });

  it('returns ok=false on validation failure', async () => {
    const bad = JSON.parse(validPayloadJson());
    bad.proposed_agent_id = 'BAD_NAME';
    const brain: BrainCallFn = async () => ({
      response_text: JSON.stringify(bad),
      cost_usd: 0,
      latency_ms: 100,
    });
    const outcome = await runSpawnLlmCall(makeRequest(), [], brain);
    expect(outcome.ok).toBe(false);
  });

  it('returns ok=false on brain-call exception', async () => {
    const brain: BrainCallFn = async () => {
      throw new Error('upstream timeout');
    };
    const outcome = await runSpawnLlmCall(makeRequest(), [], brain);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors[0]).toContain('upstream timeout');
    }
  });
});
