/**
 * seam-adapter.test.ts — proves the LIVE-SEAM bridge honours the admin config.
 *
 * With a fake reader returning an admin config, the seam:
 *   - reorders + re-ids the live provider entries to the admin's ordered
 *     core + fallback chain (ladderSource === 'admin-config'),
 *   - applies a per-use-case core override,
 *   - and `resolveEnsembleConfig` surfaces the admin ensemble mode,
 * and falls back to the live order (static-ladder) when no config is present
 * or the kill-switch is off.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  setRoutingConfigReader,
  resetRoutingConfigReader,
  resolveEnsembleConfig,
  type LlmRoutingConfig,
} from '../index.js';
import {
  applyConfigRouting,
  canonicalToFamily,
  type LiveProviderEntry,
} from '../seam-adapter.js';

// The route's live provider entries: each carries a coarse provider family +
// an opaque adapter token (here a string label standing in for an adapter).
const LIVE: ReadonlyArray<LiveProviderEntry<string>> = Object.freeze([
  { model: 'claude-sonnet-4-6', providerFamily: 'anthropic', entry: 'anthropic-adapter' },
  { model: 'gpt-5', providerFamily: 'openai', entry: 'openai-adapter' },
  { model: 'deepseek-chat', providerFamily: 'deepseek', entry: 'deepseek-adapter' },
]);

afterEach(() => {
  resetRoutingConfigReader();
  delete process.env.BORJIE_LLM_ROUTING_CONFIG;
});

describe('canonicalToFamily', () => {
  it('maps canonical ids to coarse provider families', () => {
    expect(canonicalToFamily('anthropic/claude-opus-4-8')).toBe('anthropic');
    expect(canonicalToFamily('anthropic/claude-sonnet-4-6@bedrock')).toBe('anthropic');
    expect(canonicalToFamily('openai/gpt-5')).toBe('openai');
    expect(canonicalToFamily('google/gemini-3-1-pro')).toBe('google');
    expect(canonicalToFamily('openai/deepseek-chat')).toBe('deepseek');
    expect(canonicalToFamily('claude-haiku-4-5')).toBe('anthropic'); // prefix-less
    expect(canonicalToFamily('vllm/qwen-3-6-plus')).toBe('other');
  });
});

describe('applyConfigRouting — admin config steers the live seam', () => {
  it('reorders + re-ids the live entries to the admin core + ordered fallbacks', () => {
    // Admin: OpenAI core, then Anthropic fallback. Anthropic gets the admin's
    // chosen Opus id (not the live Sonnet default).
    const config: LlmRoutingConfig = {
      coreModel: 'openai/gpt-5',
      orderedFallbacks: ['anthropic/claude-opus-4-8'],
    };
    setRoutingConfigReader((scope) => (scope === 'global' ? config : null));

    const applied = applyConfigRouting({
      task: 'chat',
      tenantId: 't1',
      live: LIVE,
    });

    expect(applied.source).toBe('admin-config');
    // Order honours the admin chain: OpenAI first, Anthropic second.
    expect(applied.ladder[0]).toEqual({ model: 'gpt-5', entry: 'openai-adapter' });
    expect(applied.ladder[1]).toEqual({
      model: 'claude-opus-4-8', // admin's chosen id, prefix-stripped for the SDK
      entry: 'anthropic-adapter',
    });
    // DeepSeek was NOT in the config → appended last with its ORIGINAL id so
    // the route keeps its full fallback breadth.
    expect(applied.ladder[2]).toEqual({ model: 'deepseek-chat', entry: 'deepseek-adapter' });
  });

  it('applies a per-use-case core override', () => {
    const config: LlmRoutingConfig = {
      coreModel: 'anthropic/claude-sonnet-4-6',
      orderedFallbacks: ['openai/gpt-5'],
      perUseCase: { casual_chat: 'openai/gpt-5-mini' },
    };
    setRoutingConfigReader(() => config);

    const applied = applyConfigRouting({
      task: 'chat',
      tenantId: 't1',
      useCase: 'casual_chat',
      live: LIVE,
    });

    expect(applied.source).toBe('admin-config');
    // Per-use-case override swaps the core to the OpenAI mini id → OpenAI is
    // now first, bound to the override id.
    expect(applied.ladder[0]).toEqual({ model: 'gpt-5-mini', entry: 'openai-adapter' });
  });

  it('falls back to the live order when no config row exists', () => {
    setRoutingConfigReader(() => null);
    const applied = applyConfigRouting({ task: 'chat', tenantId: 't1', live: LIVE });
    expect(applied.source).toBe('static-ladder');
    expect(applied.ladder).toEqual(
      LIVE.map((l) => ({ model: l.model, entry: l.entry })),
    );
  });

  it('falls back to the live order when the kill-switch is off', () => {
    process.env.BORJIE_LLM_ROUTING_CONFIG = 'off';
    setRoutingConfigReader(() => ({
      coreModel: 'openai/gpt-5',
      orderedFallbacks: [],
    }));
    const applied = applyConfigRouting({ task: 'chat', tenantId: 't1', live: LIVE });
    expect(applied.source).toBe('static-ladder');
    expect(applied.ladder[0]).toEqual({ model: 'claude-sonnet-4-6', entry: 'anthropic-adapter' });
  });

  it('falls back when the config maps to none of the live providers', () => {
    setRoutingConfigReader(() => ({
      coreModel: 'vllm/qwen-3-6-plus', // not a live provider here
      orderedFallbacks: ['google/gemini-3-1-pro'], // also not live
    }));
    const onlyAnthropic: ReadonlyArray<LiveProviderEntry<string>> = [LIVE[0]!];
    const applied = applyConfigRouting({
      task: 'chat',
      tenantId: 't1',
      live: onlyAnthropic,
    });
    expect(applied.source).toBe('static-ladder');
    expect(applied.ladder[0]).toEqual({ model: 'claude-sonnet-4-6', entry: 'anthropic-adapter' });
  });
});

describe('resolveEnsembleConfig — admin ensemble mode surfaces', () => {
  it('returns the enabled ensemble when the admin set one', () => {
    setRoutingConfigReader(() => ({
      coreModel: 'anthropic/claude-sonnet-4-6',
      orderedFallbacks: [],
      ensemble: {
        enabled: true,
        members: ['anthropic/claude-sonnet-4-6', 'openai/gpt-5'],
        combineStrategy: 'majority-vote',
      },
    }));
    const ensemble = resolveEnsembleConfig('t1');
    expect(ensemble?.enabled).toBe(true);
    expect(ensemble?.combineStrategy).toBe('majority-vote');
    expect(ensemble?.members).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5',
    ]);
  });

  it('returns null when no ensemble is configured', () => {
    setRoutingConfigReader(() => ({
      coreModel: 'anthropic/claude-sonnet-4-6',
      orderedFallbacks: [],
    }));
    expect(resolveEnsembleConfig('t1')).toBeNull();
  });
});
