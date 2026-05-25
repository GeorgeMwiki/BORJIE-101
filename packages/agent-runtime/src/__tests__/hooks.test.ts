import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HookEngine, isHookEvent } from '../hooks/index.js';
import type { HookHandler } from '../types.js';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('HookEngine — programmatic', () => {
  it('PreToolUse deny short-circuits the chain', async () => {
    const engine = new HookEngine({ projectPath: fixturesRoot });
    engine.registerHook({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: () => ({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'No bash in tests',
        },
      }),
    });
    let secondRan = false;
    engine.registerHook({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: () => {
        secondRan = true;
      },
    });
    const r = await engine.runHooks('PreToolUse', { toolName: 'Bash' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('No bash in tests');
    expect(secondRan).toBe(false);
  });

  it('PostToolUse runs every hook and accumulates additionalContext', async () => {
    const engine = new HookEngine({ projectPath: fixturesRoot });
    engine.registerHook({
      event: 'PostToolUse',
      handler: () => ({
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'A' },
      }),
    });
    engine.registerHook({
      event: 'PostToolUse',
      handler: () => ({
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'B' },
      }),
    });
    const r = await engine.runHooks('PostToolUse', { toolName: 'Read' });
    expect(r.decision).toBe('allow');
    expect(r.additionalContext).toEqual(['A', 'B']);
  });

  it('multiple PreToolUse hooks compose: ask + updatedInput', async () => {
    const engine = new HookEngine({ projectPath: fixturesRoot });
    engine.registerHook({
      event: 'PreToolUse',
      handler: () => ({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: 'sensitive op',
        },
      }),
    });
    engine.registerHook({
      event: 'PreToolUse',
      handler: () => ({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { command: 'rewritten' },
        },
      }),
    });
    const r = await engine.runHooks('PreToolUse', { toolName: 'Bash' });
    expect(r.decision).toBe('ask');
    expect(r.updatedInput).toEqual({ command: 'rewritten' });
  });

  it('matcher regex narrows the chain', async () => {
    const engine = new HookEngine({ projectPath: fixturesRoot });
    let firedOn: string[] = [];
    engine.registerHook({
      event: 'PreToolUse',
      matcher: 'Write|Edit',
      handler: (ctx) => {
        firedOn.push(ctx.toolName ?? '');
      },
    });
    await engine.runHooks('PreToolUse', { toolName: 'Write' });
    await engine.runHooks('PreToolUse', { toolName: 'Read' });
    await engine.runHooks('PreToolUse', { toolName: 'Edit' });
    expect(firedOn).toEqual(['Write', 'Edit']);
  });

  it('thrown handler in PreToolUse becomes deny for safety', async () => {
    const engine = new HookEngine({ projectPath: fixturesRoot });
    engine.registerHook({
      event: 'PreToolUse',
      handler: () => {
        throw new Error('boom');
      },
    });
    const r = await engine.runHooks('PreToolUse', { toolName: 'Bash' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toContain('threw');
  });

  it('unregister callback removes the hook', async () => {
    const engine = new HookEngine({ projectPath: fixturesRoot });
    const off = engine.registerHook({
      event: 'PreToolUse',
      handler: () => ({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
      }),
    });
    off();
    const r = await engine.runHooks('PreToolUse', { toolName: 'Bash' });
    expect(r.decision).toBe('allow');
  });
});

describe('HookEngine — file discovery', () => {
  it('loadFileHooks resolves handlers via the caller-supplied resolver', async () => {
    const engine = new HookEngine({ projectPath: fixturesRoot });
    const fired: string[] = [];
    const resolver = (name: string): HookHandler | undefined => {
      if (name === 'block-rm-rf') {
        return (ctx) => {
          const cmd = (ctx.toolInput as { command?: string } | undefined)?.command ?? '';
          if (cmd.startsWith('rm -rf')) {
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: 'rm -rf is forbidden',
              },
            };
          }
          fired.push('block-rm-rf:allow');
          return undefined;
        };
      }
      if (name === 'annotate-write') {
        return () => {
          fired.push('annotate-write');
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: 'Remember to add tests.',
            },
          };
        };
      }
      return undefined;
    };

    const loaded = await engine.loadFileHooks({ resolver });
    expect(loaded).toBe(2);

    const blocked = await engine.runHooks('PreToolUse', {
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /' },
    });
    expect(blocked.decision).toBe('deny');

    const writeRun = await engine.runHooks('PreToolUse', { toolName: 'Write' });
    expect(writeRun.decision).toBe('allow');
    expect(writeRun.additionalContext).toEqual(['Remember to add tests.']);
    expect(fired).toContain('annotate-write');
  });
});

describe('isHookEvent', () => {
  it('returns true for the 7 canonical events', () => {
    for (const ev of [
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'UserPromptSubmit',
      'SessionStart',
      'Notification',
      'PreCompact',
    ]) {
      expect(isHookEvent(ev)).toBe(true);
    }
  });
  it('returns false for arbitrary strings', () => {
    expect(isHookEvent('SomeOtherEvent')).toBe(false);
    expect(isHookEvent(123)).toBe(false);
  });
});
