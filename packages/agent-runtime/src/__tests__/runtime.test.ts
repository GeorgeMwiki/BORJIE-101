import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgentRuntime } from '../index.js';
import type { BrainPort } from '../types.js';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

let memoryRoot: string;

beforeAll(async () => {
  memoryRoot = await mkdtemp(join(tmpdir(), 'agent-runtime-bench-'));
});

afterAll(async () => {
  await rm(memoryRoot, { recursive: true, force: true });
});

describe('createAgentRuntime — barrel wiring', () => {
  it('returns a fully-wired runtime with session metadata', async () => {
    const runtime = await createAgentRuntime({
      projectPath: fixturesRoot,
      memoryRoot,
    });
    expect(runtime.session.id).toMatch(/^session-/);
    expect(runtime.hooks).toBeDefined();
    expect(runtime.slashCommands).toBeDefined();
    expect(runtime.subAgents).toBeDefined();
    expect(runtime.skills).toBeDefined();
    expect(runtime.mcp).toBeDefined();
    expect(runtime.memory).toBeDefined();
    expect(runtime.permissions).toBeDefined();
    await runtime.shutdown();
  });

  it('auto-loads permissions and applies the project mode', async () => {
    const runtime = await createAgentRuntime({
      projectPath: fixturesRoot,
      memoryRoot,
    });
    const cfg = runtime.permissions.getConfig();
    expect(cfg.mode).toBe('strict');
    expect(cfg.allow.length).toBeGreaterThan(0);
    await runtime.shutdown();
  });

  it('passes the brain through to slash command execution', async () => {
    const calls: Array<{ prompt: string }> = [];
    const brain: BrainPort = {
      call: async ({ prompt }) => {
        calls.push({ prompt });
        return { text: 'done' };
      },
    };
    const runtime = await createAgentRuntime({
      projectPath: fixturesRoot,
      memoryRoot,
      brain,
    });
    const inv = await runtime.slashCommands.executeCommand({
      name: 'ship',
      args: 'P52 fix',
      brain: runtime.brain,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain('Ship the feature: P52 fix');
    expect((inv as { response?: { text: string } }).response).toEqual({ text: 'done' });
    await runtime.shutdown();
  });

  it('ties the seven subsystems together end-to-end', async () => {
    const runtime = await createAgentRuntime({
      projectPath: fixturesRoot,
      memoryRoot,
    });

    // 1. Hook engine
    runtime.hooks.registerHook({
      event: 'PreToolUse',
      handler: () => ({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'hi' },
      }),
    });
    const hr = await runtime.hooks.runHooks('PreToolUse', { toolName: 'Read' });
    expect(hr.additionalContext).toEqual(['hi']);

    // 2. Slash commands
    const cmd = await runtime.slashCommands.loadCommand('review');
    expect(cmd).toBeDefined();

    // 3. Sub-agents
    const agents = await runtime.subAgents.listSubAgents();
    expect(agents).toContain('security-reviewer');

    // 4. Skills
    const skills = await runtime.skills.listSkills();
    expect(skills.some((s) => s.name === 'lease-renewal')).toBe(true);

    // 5. MCP
    const mcpConfigs = await runtime.mcp.loadMCPConfig();
    expect(mcpConfigs.length).toBeGreaterThan(0);

    // 6. Memory
    const entry = await runtime.memory.writeMemoryEntry({
      name: 'runtime-bench',
      type: 'fact',
      content: 'wired end-to-end',
    });
    expect(entry.name).toBe('runtime-bench');

    // 7. Permissions
    expect(runtime.permissions.checkPermission({ tool: 'Read' })).toBe('allow');

    await runtime.shutdown();
  });
});
