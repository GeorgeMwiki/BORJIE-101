/**
 * Tests for the FAIL-SAFE config-driven ladder resolver.
 *
 * INVARIANT under test: empty / absent / bad / throwing config === today's
 * static TASK_LADDER behaviour. A turn NEVER breaks because of config.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveConfigDrivenLadder,
  resolveEnsembleConfig,
  setRoutingConfigReader,
  resetRoutingConfigReader,
  type LlmRoutingConfig,
} from '../index.js';
import { TASK_LADDER } from '../../task-ladder/task-ladder.js';

afterEach(() => {
  resetRoutingConfigReader();
  delete process.env.BORJIE_LLM_ROUTING_CONFIG;
});

describe('resolveConfigDrivenLadder fail-safe', () => {
  it('with NO reader returns the static TASK_LADDER (identical to legacy)', () => {
    const result = resolveConfigDrivenLadder({ task: 'chat', tenantId: 't1' });
    expect(result.source).toBe('static-ladder');
    expect(result.ladder).toEqual([...TASK_LADDER.chat]);
  });

  it('with an EMPTY config (reader returns null) falls back to static ladder', () => {
    setRoutingConfigReader(() => null);
    const result = resolveConfigDrivenLadder({ task: 'plan', tenantId: 't1' });
    expect(result.source).toBe('static-ladder');
    expect(result.ladder).toEqual([...TASK_LADDER.plan]);
  });

  it('with a MALFORMED config (missing coreModel) falls back to static ladder', () => {
    setRoutingConfigReader(() => ({ orderedFallbacks: ['x'] } as never));
    const result = resolveConfigDrivenLadder({ task: 'chat', tenantId: 't1' });
    expect(result.source).toBe('static-ladder');
    expect(result.ladder).toEqual([...TASK_LADDER.chat]);
  });

  it('with a THROWING reader falls back to static ladder (no throw escapes)', () => {
    setRoutingConfigReader(() => {
      throw new Error('boom');
    });
    const result = resolveConfigDrivenLadder({ task: 'chat', tenantId: 't1' });
    expect(result.source).toBe('static-ladder');
    expect(result.ladder).toEqual([...TASK_LADDER.chat]);
  });

  it('when the kill-switch is OFF the admin config is bypassed entirely', () => {
    process.env.BORJIE_LLM_ROUTING_CONFIG = 'off';
    const config: LlmRoutingConfig = {
      coreModel: 'admin/core',
      orderedFallbacks: ['admin/fb'],
    };
    setRoutingConfigReader(() => config);
    const result = resolveConfigDrivenLadder({ task: 'chat', tenantId: 't1' });
    expect(result.source).toBe('static-ladder');
    expect(result.ladder).toEqual([...TASK_LADDER.chat]);
  });
});

describe('resolveConfigDrivenLadder config-driven path', () => {
  it('builds [core, ...fallbacks] from a valid admin config', () => {
    const config: LlmRoutingConfig = {
      coreModel: 'anthropic/claude-opus-4-8',
      orderedFallbacks: ['anthropic/claude-sonnet-4-6', 'openai/gpt-5'],
    };
    setRoutingConfigReader((scope) => (scope === 'global' ? config : null));
    const result = resolveConfigDrivenLadder({ task: 'chat', tenantId: 't1' });
    expect(result.source).toBe('admin-config');
    expect(result.ladder).toEqual([
      'anthropic/claude-opus-4-8',
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5',
    ]);
  });

  it('prefers the tenant scope over the global scope', () => {
    const globalCfg: LlmRoutingConfig = { coreModel: 'g/core', orderedFallbacks: [] };
    const tenantCfg: LlmRoutingConfig = { coreModel: 't/core', orderedFallbacks: ['t/fb'] };
    setRoutingConfigReader((scope) =>
      scope === 'tenant:t1' ? tenantCfg : globalCfg,
    );
    const result = resolveConfigDrivenLadder({ task: 'chat', tenantId: 't1' });
    expect(result.ladder[0]).toBe('t/core');
  });

  it('a per-call ladderOverride beats the admin config', () => {
    setRoutingConfigReader(() => ({ coreModel: 'admin/core', orderedFallbacks: [] }));
    const result = resolveConfigDrivenLadder({
      task: 'chat',
      tenantId: 't1',
      callOverride: ['call/model'],
    });
    expect(result.source).toBe('call-override');
    expect(result.ladder).toEqual(['call/model']);
  });
});

describe('per-use-case routing + locked-category guardrail', () => {
  const config: LlmRoutingConfig = {
    coreModel: 'anthropic/claude-haiku-4-5',
    orderedFallbacks: ['anthropic/claude-sonnet-4-6'],
    perUseCase: {
      casual_chat: 'anthropic/claude-haiku-4-5',
      // A locked use-case override that MUST be ignored.
      offtake_drafting: 'anthropic/claude-haiku-4-5',
    },
  };

  it('applies a per-use-case core override for an unlocked use-case', () => {
    setRoutingConfigReader(() => ({
      ...config,
      perUseCase: { deep_reasoning: 'anthropic/claude-opus-4-8' },
    }));
    const result = resolveConfigDrivenLadder({
      task: 'chat',
      tenantId: 't1',
      useCase: 'deep_reasoning',
    });
    expect(result.perUseCaseApplied).toBe(true);
    expect(result.ladder[0]).toBe('anthropic/claude-opus-4-8');
    // Fallback chain preserved beneath the overridden core.
    expect(result.ladder).toContain('anthropic/claude-sonnet-4-6');
  });

  it('NEVER applies a per-use-case override for a LOCKED category', () => {
    setRoutingConfigReader(() => config);
    const result = resolveConfigDrivenLadder({
      task: 'chat',
      tenantId: 't1',
      useCase: 'offtake_drafting', // locked
    });
    expect(result.perUseCaseApplied).toBe(false);
    // Core stays the config core, not the (forbidden) per-use-case override.
    expect(result.ladder[0]).toBe('anthropic/claude-haiku-4-5');
  });
});

describe('resolveEnsembleConfig', () => {
  it('returns null when no config exists', () => {
    expect(resolveEnsembleConfig('t1')).toBeNull();
  });

  it('returns null when the ensemble is disabled', () => {
    setRoutingConfigReader(() => ({
      coreModel: 'c',
      orderedFallbacks: [],
      ensemble: { enabled: false, members: ['a', 'b'], combineStrategy: 'first-wins' },
    }));
    expect(resolveEnsembleConfig('t1')).toBeNull();
  });

  it('returns the ensemble when enabled with members', () => {
    setRoutingConfigReader(() => ({
      coreModel: 'c',
      orderedFallbacks: [],
      ensemble: {
        enabled: true,
        members: ['a', 'b', 'c'],
        combineStrategy: 'majority-vote',
      },
    }));
    const ens = resolveEnsembleConfig('t1');
    expect(ens?.enabled).toBe(true);
    expect(ens?.members).toEqual(['a', 'b', 'c']);
    expect(ens?.combineStrategy).toBe('majority-vote');
  });

  it('returns null when the kill-switch is off', () => {
    process.env.BORJIE_LLM_ROUTING_CONFIG = '0';
    setRoutingConfigReader(() => ({
      coreModel: 'c',
      orderedFallbacks: [],
      ensemble: { enabled: true, members: ['a', 'b'], combineStrategy: 'first-wins' },
    }));
    expect(resolveEnsembleConfig('t1')).toBeNull();
  });
});
