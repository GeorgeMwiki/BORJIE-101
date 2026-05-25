import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SubAgentLoader, resolveTools } from '../sub-agents/index.js';
import type { BrainPort } from '../types.js';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('SubAgentLoader', () => {
  it('loads sub-agent with full frontmatter', async () => {
    const loader = new SubAgentLoader({ projectPath: fixturesRoot });
    const agent = await loader.loadSubAgent('security-reviewer');
    expect(agent).toBeDefined();
    expect(agent?.description.toLowerCase()).toContain('auth');
    expect(agent?.tools).toEqual(['Read', 'Grep', 'Bash']);
    expect(agent?.disallowedTools).toEqual(['Write']);
    expect(agent?.model).toBe('opus');
    expect(agent?.systemPrompt).toContain('security reviewer');
  });

  it('does NOT auto-reject when description is missing but warns', async () => {
    const loader = new SubAgentLoader({ projectPath: fixturesRoot });
    const agent = await loader.loadSubAgent('no-description-bad');
    expect(agent).toBeDefined();
    expect(agent?.description).toBe('');
  });

  it('listSubAgents enumerates *.md but excludes README.md', async () => {
    const loader = new SubAgentLoader({ projectPath: fixturesRoot });
    const list = await loader.listSubAgents();
    expect(list).toContain('security-reviewer');
    expect(list).toContain('no-description-bad');
  });

  it('invokeSubAgent passes resolved tool list + system prompt', async () => {
    const seen: Array<{
      systemPrompt?: string;
      allowedTools?: ReadonlyArray<string>;
      model?: string;
    }> = [];
    const brain: BrainPort = {
      call: async (args) => {
        seen.push({
          ...(args.systemPrompt !== undefined ? { systemPrompt: args.systemPrompt } : {}),
          ...(args.allowedTools !== undefined ? { allowedTools: args.allowedTools } : {}),
          ...(args.model !== undefined ? { model: args.model } : {}),
        });
        return { text: 'no findings' };
      },
    };
    const loader = new SubAgentLoader({ projectPath: fixturesRoot });
    const inv = await loader.invokeSubAgent({
      name: 'security-reviewer',
      prompt: 'Review the diff',
      brain,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.systemPrompt).toContain('security reviewer');
    expect(seen[0]?.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
    expect(seen[0]?.model).toBe('opus');
    expect(inv.response).toEqual({ text: 'no findings' });
  });

  it('throws when sub-agent not found', async () => {
    const loader = new SubAgentLoader({ projectPath: fixturesRoot });
    await expect(
      loader.invokeSubAgent({
        name: 'does-not-exist',
        prompt: 'hi',
        brain: { call: async () => ({ text: '' }) },
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('resolveTools', () => {
  it('returns undefined when neither parent nor agent restricts', () => {
    expect(resolveTools(undefined, undefined, undefined)).toBeUndefined();
  });
  it('inherits parent when agent has no tools field', () => {
    expect(resolveTools(['Read', 'Edit'], undefined, undefined)).toEqual(['Read', 'Edit']);
  });
  it('inherits agent when parent has no restriction', () => {
    expect(resolveTools(undefined, ['Read'], undefined)).toEqual(['Read']);
  });
  it('intersects parent and agent to prevent privilege escalation', () => {
    expect(resolveTools(['Read', 'Edit'], ['Read', 'Write'], undefined)).toEqual(['Read']);
  });
  it('subtracts disallowed-tools', () => {
    expect(resolveTools(['Read', 'Edit', 'Write'], undefined, ['Write'])).toEqual([
      'Read',
      'Edit',
    ]);
  });
  it('returns deny sentinel when only disallowed and no positive list', () => {
    expect(resolveTools(undefined, undefined, ['Write'])).toEqual(['!Write']);
  });
});
