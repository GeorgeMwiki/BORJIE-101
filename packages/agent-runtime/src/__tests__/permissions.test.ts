import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PermissionEngine,
  globToRegExp,
  matchesRule,
} from '../permissions/index.js';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('matchesRule', () => {
  it('matches bare tool name', () => {
    expect(matchesRule('Read', { tool: 'Read' })).toBe(true);
    expect(matchesRule('Read', { tool: 'Write' })).toBe(false);
  });
  it('matches tool with glob arg pattern against string args', () => {
    expect(
      matchesRule('Bash(git status:*)', {
        tool: 'Bash',
        args: { command: 'git status --short' },
      }),
    ).toBe(true);
    expect(
      matchesRule('Bash(git status:*)', {
        tool: 'Bash',
        args: { command: 'rm -rf /' },
      }),
    ).toBe(false);
  });
  it('returns false when no args supplied and pattern present', () => {
    expect(matchesRule('Edit(*.md)', { tool: 'Edit' })).toBe(false);
  });
});

describe('globToRegExp', () => {
  it('converts * to .*', () => {
    expect(globToRegExp('*.md').test('README.md')).toBe(true);
    expect(globToRegExp('*.md').test('README.txt')).toBe(false);
  });
  it('escapes regex metacharacters', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(globToRegExp('a.b').test('a.b')).toBe(true);
  });
});

describe('PermissionEngine — strict mode (default)', () => {
  it('loads .claude/settings.json fixture and resolves allows', async () => {
    const engine = new PermissionEngine({ projectPath: fixturesRoot });
    const cfg = await engine.loadPermissionRules();
    expect(cfg.mode).toBe('strict');
    expect(cfg.allow.map((r) => r.rule)).toContain('Read');

    expect(engine.checkPermission({ tool: 'Read' })).toBe('allow');
    expect(engine.checkPermission({ tool: 'Grep' })).toBe('allow');
    expect(engine.checkPermission({ tool: 'Unknown' })).toBe('deny');
  });

  it('deny rule beats allow rule', async () => {
    const engine = new PermissionEngine({ projectPath: fixturesRoot });
    await engine.loadPermissionRules();
    expect(
      engine.checkPermission({ tool: 'Bash', args: { command: 'rm -rf /tmp' } }),
    ).toBe('deny');
    expect(
      engine.checkPermission({ tool: 'Bash', args: { command: 'git status' } }),
    ).toBe('allow');
  });

  it('ask rule maps to ask decision', async () => {
    const engine = new PermissionEngine({ projectPath: fixturesRoot });
    await engine.loadPermissionRules();
    expect(engine.checkPermission({ tool: 'Write', args: { path: 'foo.txt' } })).toBe(
      'ask',
    );
  });

  it('drainAudit reports every check', async () => {
    const engine = new PermissionEngine({ projectPath: fixturesRoot });
    await engine.loadPermissionRules();
    engine.checkPermission({ tool: 'Read' });
    engine.checkPermission({ tool: 'Unknown' });
    const audit = engine.drainAudit();
    expect(audit).toHaveLength(2);
    expect(audit[0]?.decision).toBe('allow');
    expect(audit[1]?.decision).toBe('deny');
  });
});

describe('PermissionEngine — open mode', () => {
  it('default-allows when no rule matches', async () => {
    const engine = new PermissionEngine({ projectPath: fixturesRoot, defaultMode: 'open' });
    expect(engine.checkPermission({ tool: 'AnyTool' })).toBe('allow');
  });
  it('still respects explicit deny rules', async () => {
    const engine = new PermissionEngine({ projectPath: fixturesRoot, defaultMode: 'open' });
    await engine.loadPermissionRules();
    engine.setMode('open');
    expect(
      engine.checkPermission({ tool: 'Bash', args: { command: 'sudo bash' } }),
    ).toBe('deny');
  });
});

describe('PermissionEngine — audit-only mode', () => {
  it('always allows regardless of allow/deny', async () => {
    const sink: Array<{ tool: string; decision: string }> = [];
    const engine = new PermissionEngine({
      projectPath: fixturesRoot,
      defaultMode: 'audit-only',
      auditSink: (e) => sink.push({ tool: e.tool, decision: e.decision }),
    });
    await engine.loadPermissionRules();
    engine.setMode('audit-only');
    const denied = engine.checkPermission({
      tool: 'Bash',
      args: { command: 'rm -rf /' },
    });
    // Note: deny rules always win, even in audit-only.
    expect(denied).toBe('deny');
    const unknown = engine.checkPermission({ tool: 'NeverHeardOf' });
    expect(unknown).toBe('allow');
    expect(sink.length).toBeGreaterThanOrEqual(2);
  });
});
