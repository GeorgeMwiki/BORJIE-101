import { describe, expect, it } from 'vitest';

import {
  asClaudeAgentSdkHook,
  createSelfCodegenHook,
} from './create-hook.js';
import { anyGlobMatches, globToMatcher } from './glob-matcher.js';
import { DEFAULT_DENY_GLOBS } from './types.js';

describe('pre-tool-use-hooks — glob-matcher', () => {
  it('matches simple ** patterns', () => {
    expect(globToMatcher('packages/**/*.ts')('packages/x/y.ts')).toBe(true);
    expect(globToMatcher('packages/**/*.ts')('packages/y.ts')).toBe(true);
    expect(globToMatcher('packages/**/*.ts')('apps/x.ts')).toBe(false);
  });

  it('matches the 6 default deny-globs against real-world paths', () => {
    const samples: Record<string, string> = {
      '**/migrations/**': 'packages/database/src/migrations/2026-05-19.ts',
      '**/m-pesa/**': 'packages/connectors/m-pesa/retry.ts',
      '.claude/**': '.claude/agents/code-reviewer.md',
      '.github/workflows/**': '.github/workflows/ci.yml',
      '**/*.env*': 'apps/web/.env.production',
      '**/secrets/**': 'config/secrets/keystore.json',
    };
    for (const [glob, path] of Object.entries(samples)) {
      expect(globToMatcher(glob)(path)).toBe(true);
    }
  });

  it('anyGlobMatches returns the matched glob', () => {
    const hit = anyGlobMatches(DEFAULT_DENY_GLOBS, '.github/workflows/ci.yml');
    expect(hit.matched).toBe(true);
    if (hit.matched) expect(hit.glob).toBe('.github/workflows/**');
  });
});

describe('pre-tool-use-hooks — createSelfCodegenHook', () => {
  it('denies all 6 default deny-globs for Write/Edit/Delete', async () => {
    const hook = createSelfCodegenHook();
    const tools = ['Write', 'Edit', 'Delete'];
    const paths: Record<string, string> = {
      m: 'packages/database/src/migrations/2026.ts',
      n: 'packages/connectors/m-pesa/retry.ts',
      c: '.claude/skills/foo/SKILL.md',
      w: '.github/workflows/ci.yml',
      e: 'apps/web/.env.production',
      s: 'config/secrets/keystore.json',
    };
    for (const t of tools) {
      for (const p of Object.values(paths)) {
        const d = await hook({ toolName: t, toolInput: { file_path: p } });
        expect(d.kind).toBe('deny');
        if (d.kind === 'deny') {
          expect(d.code).toBe('destructive-glob');
        }
      }
    }
  });

  it('allows benign paths for Write', async () => {
    const hook = createSelfCodegenHook();
    const d = await hook({
      toolName: 'Write',
      toolInput: { file_path: 'packages/self-codegen/README.md' },
    });
    expect(d.kind).toBe('allow');
  });

  it('does not inspect Read/Grep tools', async () => {
    const hook = createSelfCodegenHook();
    const d = await hook({
      toolName: 'Read',
      toolInput: { file_path: '.github/workflows/ci.yml' },
    });
    expect(d.kind).toBe('allow');
  });

  it('returns ask when no file_path is provided to a write-class tool', async () => {
    const hook = createSelfCodegenHook();
    const d = await hook({ toolName: 'Write', toolInput: {} });
    expect(d.kind).toBe('ask');
  });

  it('returns ask for paths matching requireApproval', async () => {
    const hook = createSelfCodegenHook({
      requireApproval: ['services/payments-ledger/**'],
    });
    const d = await hook({
      toolName: 'Edit',
      toolInput: { file_path: 'services/payments-ledger/index.ts' },
    });
    expect(d.kind).toBe('ask');
  });

  it('custom denyGlobs override defaults', async () => {
    const hook = createSelfCodegenHook({ denyGlobs: ['custom-thing/**'] });
    // Default deny-glob no longer fires:
    const d1 = await hook({
      toolName: 'Write',
      toolInput: { file_path: '.github/workflows/ci.yml' },
    });
    expect(d1.kind).toBe('allow');
    // Custom does fire:
    const d2 = await hook({
      toolName: 'Write',
      toolInput: { file_path: 'custom-thing/foo.ts' },
    });
    expect(d2.kind).toBe('deny');
  });
});

describe('pre-tool-use-hooks — asClaudeAgentSdkHook', () => {
  it('translates allow to empty object', async () => {
    const adapted = asClaudeAgentSdkHook(createSelfCodegenHook());
    const out = await adapted({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'packages/x/y.ts' },
    });
    expect(out).toEqual({});
  });

  it('translates deny into SDK shape with permissionDecision=deny', async () => {
    const adapted = asClaudeAgentSdkHook(createSelfCodegenHook());
    const out = await adapted({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '.github/workflows/ci.yml' },
    });
    expect((out.hookSpecificOutput as { permissionDecision: string }).permissionDecision).toBe('deny');
  });

  it('returns empty for non-PreToolUse events', async () => {
    const adapted = asClaudeAgentSdkHook(createSelfCodegenHook());
    const out = await adapted({ hook_event_name: 'PostToolUse' });
    expect(out).toEqual({});
  });
});
