import { describe, expect, it } from 'vitest';
import { compileAST, compileAOP } from '../index.js';
import { compileToCron } from '../compiler/to-cron.js';
import { compileToMonitors } from '../compiler/to-monitor.js';
import { compileToHookChain } from '../compiler/to-hook-chain.js';
import { compileToSkill } from '../compiler/to-skill.js';
import { arrearsChase } from './fixtures/arrears-chase.aop.js';
import { leaseRenewal } from './fixtures/lease-renewal.aop.js';
import { kraFiling } from './fixtures/kra-filing.aop.js';
import { buildRegistry, FIXTURE_TOOLS, buildStubLLM } from './_test-helpers.js';
import { ARREARS_CHASE_NL } from './fixtures/nl-inputs.js';

describe('compileToSkill', () => {
  it('emits a SKILL bundle with frontmatter, body, and metadata', () => {
    const bundle = compileToSkill(arrearsChase);
    expect(bundle.id).toBe('aop.monthly-arrears-chase');
    expect(bundle.markdown.startsWith('---')).toBe(true);
    expect(bundle.markdown).toContain('## Steps');
    expect(bundle.markdown).toContain('send-reminder');
    expect(bundle.metadata.name).toBe('monthly-arrears-chase');
  });
});

describe('compileToCron', () => {
  it('returns cron spec for cron-triggered AOPs', () => {
    const c = compileToCron(arrearsChase);
    expect(c).not.toBeNull();
    expect(c?.schedule).toBe('0 9 25 * *');
    expect(c?.timezone).toBe('Africa/Nairobi');
  });

  it('returns null for event-triggered AOPs', () => {
    expect(compileToCron(leaseRenewal)).toBeNull();
  });
});

describe('compileToMonitors', () => {
  it('flat-lists every monitor in arrears-chase', () => {
    const monitors = compileToMonitors(arrearsChase);
    expect(monitors.map((m) => m.stepId).sort()).toEqual(['wait-3d', 'wait-7d']);
  });

  it('handles AOPs with one monitor (kra)', () => {
    const monitors = compileToMonitors(kraFiling);
    expect(monitors).toHaveLength(1);
    expect(monitors[0]!.stepId).toBe('wait-kra');
  });
});

describe('compileToHookChain', () => {
  it('collects ask-owner hook from arrears-chase', () => {
    const hooks = compileToHookChain(arrearsChase);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.kind).toBe('ask-owner');
    expect(hooks[0]!.prompt).toContain('eviction');
  });

  it('collects ask-owner hook from lease-renewal', () => {
    const hooks = compileToHookChain(leaseRenewal);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.kind).toBe('ask-owner');
  });
});

describe('compileAST end-to-end', () => {
  it('compiles each fixture into a full bundle', () => {
    const reg = buildRegistry(FIXTURE_TOOLS);
    for (const ast of [arrearsChase, leaseRenewal, kraFiling]) {
      const result = compileAST(ast, { toolRegistry: reg });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skill.id).toBe(`aop.${ast.name}`);
        expect(result.monitors.length).toBeGreaterThanOrEqual(1);
        expect(result.diagram).toContain('flowchart TD');
        expect(result.prose).toContain(ast.name);
      }
    }
  });

  it('fails compile when a tool is missing', () => {
    const reg = buildRegistry({}); // empty registry
    const result = compileAST(arrearsChase, { toolRegistry: reg });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'unknown-tool')).toBe(true);
    }
  });
});

describe('compileAOP (NL -> compiled)', () => {
  it('parses NL via stub LLM and compiles all the way through', async () => {
    const llm = buildStubLLM([
      { contains: ARREARS_CHASE_NL.slice(0, 40), respond: arrearsChase },
    ]);
    const reg = buildRegistry(FIXTURE_TOOLS);
    const result = await compileAOP(ARREARS_CHASE_NL, {
      llm,
      toolRegistry: reg,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cron?.schedule).toBe('0 9 25 * *');
      expect(result.hooks).toHaveLength(1);
    }
  });

  it('propagates parser errors', async () => {
    const llm = buildStubLLM([{ contains: 'noise', respond: '{ broken' }]);
    const reg = buildRegistry(FIXTURE_TOOLS);
    const result = await compileAOP('noise input', { llm, toolRegistry: reg });
    expect(result.ok).toBe(false);
  });
});
