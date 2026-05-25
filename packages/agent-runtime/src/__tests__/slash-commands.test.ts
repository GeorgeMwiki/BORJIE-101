import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SlashCommandLoader, substituteArguments } from '../slash-commands/index.js';
import type { BrainPort } from '../types.js';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('substituteArguments', () => {
  it('replaces $ARGUMENTS', () => {
    expect(substituteArguments('Hi $ARGUMENTS!', 'Alice')).toBe('Hi Alice!');
  });
  it('replaces every occurrence', () => {
    expect(substituteArguments('A $ARGUMENTS B $ARGUMENTS', 'x')).toBe('A x B x');
  });
  it('handles dollar signs in args without regex pitfalls', () => {
    expect(substituteArguments('cmd $ARGUMENTS', '$&')).toBe('cmd $&');
  });
});

describe('SlashCommandLoader', () => {
  it('loads a command with full frontmatter', async () => {
    const loader = new SlashCommandLoader({ projectPath: fixturesRoot });
    const cmd = await loader.loadCommand('review');
    expect(cmd).toBeDefined();
    expect(cmd?.description).toBe('Review the diff for correctness');
    expect(cmd?.argumentHint).toBe('optional area to focus on');
    expect(cmd?.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
    expect(cmd?.model).toBe('claude-sonnet-4-5');
    expect(cmd?.prompt).toContain('Focus area: $ARGUMENTS');
  });

  it('loads a command with minimal frontmatter', async () => {
    const loader = new SlashCommandLoader({ projectPath: fixturesRoot });
    const cmd = await loader.loadCommand('ship');
    expect(cmd?.description).toBe('Ship a feature');
    expect(cmd?.allowedTools).toBeUndefined();
  });

  it('returns undefined for unknown command', async () => {
    const loader = new SlashCommandLoader({ projectPath: fixturesRoot });
    const cmd = await loader.loadCommand('does-not-exist');
    expect(cmd).toBeUndefined();
  });

  it('listCommands enumerates fixtures', async () => {
    const loader = new SlashCommandLoader({ projectPath: fixturesRoot });
    const list = await loader.listCommands();
    expect(list).toContain('review');
    expect(list).toContain('ship');
  });

  it('executeCommand substitutes $ARGUMENTS', async () => {
    const loader = new SlashCommandLoader({ projectPath: fixturesRoot });
    const inv = await loader.executeCommand({ name: 'review', args: 'authz layer' });
    expect(inv.resolvedPrompt).toContain('Focus area: authz layer');
    expect(inv.name).toBe('review');
    expect(inv.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
  });

  it('executeCommand calls brain when wired', async () => {
    const seen: Array<{ prompt: string; allowedTools?: ReadonlyArray<string> }> = [];
    const brain: BrainPort = {
      call: async (args) => {
        seen.push({
          prompt: args.prompt,
          ...(args.allowedTools !== undefined ? { allowedTools: args.allowedTools } : {}),
        });
        return { text: 'OK' };
      },
    };
    const loader = new SlashCommandLoader({ projectPath: fixturesRoot });
    const inv = await loader.executeCommand({ name: 'review', args: 'cache', brain });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.prompt).toContain('cache');
    expect(seen[0]?.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
    expect((inv as { response?: { text: string } }).response).toEqual({ text: 'OK' });
  });

  it('caches results until invalidated', async () => {
    const loader = new SlashCommandLoader({ projectPath: fixturesRoot });
    const a = await loader.loadCommand('review');
    const b = await loader.loadCommand('review');
    expect(a).toBe(b);
    loader.invalidate();
    const c = await loader.loadCommand('review');
    expect(c).not.toBe(a);
  });
});
