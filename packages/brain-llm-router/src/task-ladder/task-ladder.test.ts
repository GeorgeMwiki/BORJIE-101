/**
 * Unit tests for task-ladder/.
 *
 * Coverage:
 *   - default ladder picks expected model per task kind
 *   - tenant override supersedes default
 *   - per-call override supersedes tenant override
 *   - depth selection returns undefined past ladder length
 *   - returned ladder is frozen (immutable)
 *   - ALL_TASK_KINDS covers every entry in TASK_LADDER
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_TASK_KINDS,
  resolveLadder,
  selectAtDepth,
  TASK_LADDER,
  type TenantLadderMap,
} from './task-ladder.js';

describe('TASK_LADDER defaults', () => {
  it('plan ladder leads with Opus', () => {
    expect(TASK_LADDER.plan[0]).toBe('anthropic/claude-opus-4-7');
  });

  it('tool-use ladder leads with Sonnet (SWE-bench Pareto frontier)', () => {
    expect(TASK_LADDER['tool-use'][0]).toBe('anthropic/claude-sonnet-4-6');
  });

  it('critic ladder leads with Haiku (cost-optimised)', () => {
    expect(TASK_LADDER.critic[0]).toBe('anthropic/claude-haiku-4-5');
  });

  it('classify ladder leads with Haiku', () => {
    expect(TASK_LADDER.classify[0]).toBe('anthropic/claude-haiku-4-5');
  });

  it('chat ladder leads with Haiku then Sonnet then GPT-5 (cost-cascade target)', () => {
    expect(TASK_LADDER.chat).toEqual([
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5',
    ]);
  });

  it('longdoc ladder leads with Gemini 3.1 Pro (1M context strength)', () => {
    expect(TASK_LADDER.longdoc[0]).toBe('google/gemini-3-1-pro');
  });

  it('codegen ladder leads with Sonnet 4.6 (SWE-bench 79.6%)', () => {
    expect(TASK_LADDER.codegen[0]).toBe('anthropic/claude-sonnet-4-6');
  });

  it('every TaskKind has a non-empty ladder', () => {
    for (const task of ALL_TASK_KINDS) {
      expect(TASK_LADDER[task].length).toBeGreaterThan(0);
    }
  });

  it('TASK_LADDER and all entries are frozen', () => {
    expect(Object.isFrozen(TASK_LADDER)).toBe(true);
    expect(Object.isFrozen(TASK_LADDER.plan)).toBe(true);
  });
});

describe('resolveLadder', () => {
  it('returns default ladder when no override', () => {
    const ladder = resolveLadder('plan', 'tnt_default');
    expect(ladder[0]).toBe('anthropic/claude-opus-4-7');
  });

  it('uses tenant override when present', () => {
    const overrides: TenantLadderMap = {
      tnt_vip: { plan: ['anthropic/claude-opus-4-7', 'openai/gpt-5-pro'] },
    };
    const ladder = resolveLadder('plan', 'tnt_vip', overrides);
    expect(ladder).toEqual(['anthropic/claude-opus-4-7', 'openai/gpt-5-pro']);
  });

  it('falls back to default when tenant override exists but task missing', () => {
    const overrides: TenantLadderMap = {
      tnt_vip: { plan: ['custom/plan-model'] },
    };
    const ladder = resolveLadder('chat', 'tnt_vip', overrides);
    expect(ladder[0]).toBe('anthropic/claude-haiku-4-5');
  });

  it('per-call override takes highest precedence', () => {
    const overrides: TenantLadderMap = {
      tnt_vip: { plan: ['tenant-pin-model'] },
    };
    const ladder = resolveLadder('plan', 'tnt_vip', overrides, ['call-pin-model']);
    expect(ladder).toEqual(['call-pin-model']);
  });

  it('returns frozen array (cannot be mutated by caller)', () => {
    const ladder = resolveLadder('chat', 'tnt_x');
    expect(Object.isFrozen(ladder)).toBe(true);
  });

  it('handles missing override map gracefully', () => {
    const ladder = resolveLadder('classify', 'tnt_unknown');
    expect(ladder).toEqual(TASK_LADDER.classify);
  });
});

describe('selectAtDepth', () => {
  it('returns the model at the requested depth', () => {
    expect(selectAtDepth('plan', 'tnt_x', 0)).toBe('anthropic/claude-opus-4-7');
    expect(selectAtDepth('plan', 'tnt_x', 1)).toBe('anthropic/claude-sonnet-4-6@bedrock');
    expect(selectAtDepth('plan', 'tnt_x', 2)).toBe('openai/gpt-5-pro');
  });

  it('returns undefined past ladder length', () => {
    expect(selectAtDepth('plan', 'tnt_x', 99)).toBeUndefined();
  });
});

describe('ALL_TASK_KINDS', () => {
  it('lists exactly 7 task kinds', () => {
    expect(ALL_TASK_KINDS.length).toBe(7);
  });

  it('covers every TASK_LADDER entry', () => {
    for (const kind of ALL_TASK_KINDS) {
      expect(TASK_LADDER[kind]).toBeDefined();
    }
  });
});
