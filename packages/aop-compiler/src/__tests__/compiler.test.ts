import { describe, expect, it } from 'vitest';
import { compileAST, compileAOP } from '../index.js';
import { compileToCron } from '../compiler/to-cron.js';
import { compileToMonitors } from '../compiler/to-monitor.js';
import { compileToHookChain } from '../compiler/to-hook-chain.js';
import { compileToSkill } from '../compiler/to-skill.js';
import { royaltyArrearsChase } from './fixtures/royalty-arrears-chase.aop.js';
import { offtakeRenewal } from './fixtures/offtake-renewal.aop.js';
import { traFiling } from './fixtures/tra-filing.aop.js';
import { buildRegistry, FIXTURE_TOOLS, buildStubLLM } from './_test-helpers.js';
import { ROYALTY_ARREARS_CHASE_NL } from './fixtures/nl-inputs.js';

describe('compileToSkill', () => {
  it('emits a SKILL bundle with frontmatter, body, and metadata', () => {
    const bundle = compileToSkill(royaltyArrearsChase);
    expect(bundle.id).toBe('aop.monthly-royalty-arrears-chase');
    expect(bundle.markdown.startsWith('---')).toBe(true);
    expect(bundle.markdown).toContain('## Steps');
    expect(bundle.markdown).toContain('send-reminder');
    expect(bundle.metadata.name).toBe('monthly-royalty-arrears-chase');
  });
});

describe('compileToCron', () => {
  it('returns cron spec for cron-triggered AOPs', () => {
    const c = compileToCron(royaltyArrearsChase);
    expect(c).not.toBeNull();
    expect(c?.schedule).toBe('0 9 25 * *');
    expect(c?.timezone).toBe('Africa/Dar_es_Salaam');
  });

  it('returns null for event-triggered AOPs', () => {
    expect(compileToCron(offtakeRenewal)).toBeNull();
  });
});

describe('compileToMonitors', () => {
  it('flat-lists every monitor in royalty-arrears-chase', () => {
    const monitors = compileToMonitors(royaltyArrearsChase);
    expect(monitors.map((m) => m.stepId).sort()).toEqual(['wait-3d', 'wait-7d']);
  });

  it('handles AOPs with one monitor (tra)', () => {
    const monitors = compileToMonitors(traFiling);
    expect(monitors).toHaveLength(1);
    expect(monitors[0]!.stepId).toBe('wait-tra');
  });
});

describe('compileToHookChain', () => {
  it('collects ask-owner hook from royalty-arrears-chase', () => {
    const hooks = compileToHookChain(royaltyArrearsChase);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.kind).toBe('ask-owner');
    expect(hooks[0]!.prompt).toContain('suspension');
  });

  it('collects ask-owner hook from offtake-renewal', () => {
    const hooks = compileToHookChain(offtakeRenewal);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.kind).toBe('ask-owner');
  });
});

describe('compileAST end-to-end', () => {
  it('compiles each fixture into a full bundle', () => {
    const reg = buildRegistry(FIXTURE_TOOLS);
    for (const ast of [royaltyArrearsChase, offtakeRenewal, traFiling]) {
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
    const result = compileAST(royaltyArrearsChase, { toolRegistry: reg });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'unknown-tool')).toBe(true);
    }
  });
});

describe('compileAOP (NL -> compiled)', () => {
  it('parses NL via stub LLM and compiles all the way through', async () => {
    const llm = buildStubLLM([
      {
        contains: ROYALTY_ARREARS_CHASE_NL.slice(0, 40),
        respond: royaltyArrearsChase,
      },
    ]);
    const reg = buildRegistry(FIXTURE_TOOLS);
    const result = await compileAOP(ROYALTY_ARREARS_CHASE_NL, {
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
