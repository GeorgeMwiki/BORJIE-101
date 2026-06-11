/**
 * Intelligence-Elasticity seam tests.
 *
 * Proves the two LAW guarantees:
 *  (a) DEFAULT resolution is behavior-identical — yields EXACTLY today's
 *      production model ids (the pure-repoint invariant), and
 *  (b) an injected composition-root map overrides resolution without any
 *      call-site code change.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEFAULT_LEGACY_OPENAI_MODEL_IDS,
  DEFAULT_TIER_MODEL_IDS,
  resolveLegacyOpenAiModelId,
  resolveTierModelId,
  setLegacyOpenAiModelMap,
  setModelTierMap,
} from '../model-resolution.js';
import { ANTHROPIC_MODELS } from '../providers/anthropic.js';
import { ModelTier } from '../providers/anthropic-client.js';
import { runClaudeJunior, type ClaudeClient } from '../juniors/_shared.js';

afterEach(() => {
  setModelTierMap(undefined);
  setLegacyOpenAiModelMap(undefined);
});

describe('model-resolution — rank-driven reasoning deck (LAW guarantee a)', () => {
  it('resolves Claude tiers to the capability cascade (deep=Fable core reasoning)', () => {
    expect(resolveTierModelId('cheap')).toBe('claude-haiku-4-5');
    expect(resolveTierModelId('standard')).toBe('claude-opus-4-8');
    expect(resolveTierModelId('deep')).toBe('claude-fable-5');
  });

  it('resolves legacy OpenAI slots to EXACTLY today\'s ids', () => {
    expect(resolveLegacyOpenAiModelId()).toBe('gpt-4-turbo-preview');
    expect(resolveLegacyOpenAiModelId('default')).toBe('gpt-4-turbo-preview');
    expect(resolveLegacyOpenAiModelId('vision')).toBe('gpt-4-turbo');
    expect(resolveLegacyOpenAiModelId('transcribe')).toBe('gpt-4o-mini-transcribe');
    expect(resolveLegacyOpenAiModelId('tts')).toBe('gpt-4o-mini-tts');
  });

  it('keeps the frozen default map on the rank-driven cascade', () => {
    expect(DEFAULT_TIER_MODEL_IDS).toEqual({
      cheap: 'claude-haiku-4-5',
      standard: 'claude-opus-4-8',
      deep: 'claude-fable-5',
    });
    expect(DEFAULT_LEGACY_OPENAI_MODEL_IDS).toEqual({
      default: 'gpt-4-turbo-preview',
      vision: 'gpt-4-turbo',
      transcribe: 'gpt-4o-mini-transcribe',
      tts: 'gpt-4o-mini-tts',
    });
    expect(Object.isFrozen(DEFAULT_TIER_MODEL_IDS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LEGACY_OPENAI_MODEL_IDS)).toBe(true);
  });

  it('provider catalogs derive by FAMILY from the registry (names stay id-correct)', () => {
    expect(ANTHROPIC_MODELS.FABLE).toBe('claude-fable-5');
    expect(ANTHROPIC_MODELS.OPUS_4_8).toBe('claude-opus-4-8');
    expect(ANTHROPIC_MODELS.SONNET_4_6).toBe('claude-sonnet-4-6');
    expect(ANTHROPIC_MODELS.HAIKU_4_5).toBe('claude-haiku-4-5');
    expect(ModelTier.FABLE).toBe('claude-fable-5');
    expect(ModelTier.HAIKU).toBe('claude-haiku-4-5');
    expect(ModelTier.SONNET).toBe('claude-sonnet-4-6');
    expect(ModelTier.OPUS).toBe('claude-opus-4-8');
  });
});

describe('model-resolution — injected map overrides (LAW guarantee b)', () => {
  it('an injected tier map overrides only the injected tiers', () => {
    // Inject a hypothetical superior model onto deep; cheap/standard fall
    // through to the rank-driven cascade defaults.
    setModelTierMap({ deep: 'claude-mythos-1' });
    expect(resolveTierModelId('deep')).toBe('claude-mythos-1');
    expect(resolveTierModelId('cheap')).toBe('claude-haiku-4-5');
    expect(resolveTierModelId('standard')).toBe('claude-opus-4-8');
  });

  it('clearing the injection restores behavior-identical defaults', () => {
    setModelTierMap({ cheap: 'claude-haiku-9-9' });
    expect(resolveTierModelId('cheap')).toBe('claude-haiku-9-9');
    setModelTierMap(undefined);
    expect(resolveTierModelId('cheap')).toBe('claude-haiku-4-5');
  });

  it('a per-call map override wins over the injected map', () => {
    setModelTierMap({ standard: 'injected-standard' });
    expect(
      resolveTierModelId('standard', { standard: 'per-call-standard' }),
    ).toBe('per-call-standard');
  });

  it('whitespace-only per-call entries fall back to the default', () => {
    expect(resolveTierModelId('cheap', { cheap: '   ' })).toBe('claude-haiku-4-5');
  });

  it('rejects malformed injected maps loudly at the seam (zod)', () => {
    expect(() => setModelTierMap({ cheap: '' })).toThrow();
    expect(() =>
      setModelTierMap({ chepa: 'typo-tier' } as never),
    ).toThrow();
    expect(() => setLegacyOpenAiModelMap({ default: '' })).toThrow();
  });

  it('legacy OpenAI injection overrides without code change', () => {
    setLegacyOpenAiModelMap({ default: 'gpt-5o', vision: 'gpt-5o-vision' });
    expect(resolveLegacyOpenAiModelId()).toBe('gpt-5o');
    expect(resolveLegacyOpenAiModelId('vision')).toBe('gpt-5o-vision');
    expect(resolveLegacyOpenAiModelId('tts')).toBe('gpt-4o-mini-tts');
  });
});

describe('runClaudeJunior — the ~30-junior inheritance point', () => {
  const OutputSchema = z.object({
    confidence: z.number(),
    rationale: z.string(),
    evidence_ids: z.array(z.string()),
  });

  const JUNIOR_JSON = JSON.stringify({
    confidence: 0.9,
    rationale: 'test',
    evidence_ids: ['ev_1'],
  });

  function capturingClaude(): { claude: ClaudeClient; calls: string[] } {
    const calls: string[] = [];
    const claude: ClaudeClient = {
      async complete(args) {
        calls.push(args.model ?? '<none>');
        return { content: JUNIOR_JSON };
      },
    };
    return { claude, calls };
  }

  it('passes today\'s exact cheap-tier id when no model is supplied (behavior-identical)', async () => {
    const { claude, calls } = capturingClaude();
    await runClaudeJunior({
      claude,
      systemPrompt: 's',
      userPrompt: 'u',
      schema: OutputSchema,
      juniorName: 'test-junior',
    });
    expect(calls).toEqual(['claude-haiku-4-5']);
  });

  it('an injected map repoints all default-inheriting juniors without code change', async () => {
    setModelTierMap({ cheap: 'claude-haiku-next' });
    const { claude, calls } = capturingClaude();
    await runClaudeJunior({
      claude,
      systemPrompt: 's',
      userPrompt: 'u',
      schema: OutputSchema,
      juniorName: 'test-junior',
    });
    expect(calls).toEqual(['claude-haiku-next']);
  });

  it('an explicit per-junior model still wins over injection', async () => {
    setModelTierMap({ cheap: 'claude-haiku-next' });
    const { claude, calls } = capturingClaude();
    await runClaudeJunior({
      claude,
      systemPrompt: 's',
      userPrompt: 'u',
      schema: OutputSchema,
      juniorName: 'test-junior',
      model: resolveTierModelId('deep'),
    });
    expect(calls).toEqual(['claude-fable-5']);
  });
});
