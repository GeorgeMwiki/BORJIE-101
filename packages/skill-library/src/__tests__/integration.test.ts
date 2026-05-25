/**
 * Integration tests — 8 cross-module flows that exercise the boundaries
 * between subagent-spawn, filesystem-skills, mcp-tool-search,
 * voyager-library, and the 6 built-in skills.
 */

import { describe, expect, it } from 'vitest';
import {
  // subagent-spawn
  spawnSubAgent,
  InMemorySubAgentRunner,
  // filesystem-skills
  discoverSkills,
  applyAllowlist,
  InMemorySkillFileSystem,
  // mcp-tool-search
  McpToolRegistry,
  // voyager-library
  VoyagerSkillLibrary,
  StubEntityStore,
  EchoSkillCompiler,
  // built-ins
  BUILTIN_SKILLS,
  handleLateRentSkill,
  prepareKraFilingSkill,
} from '../index.js';
import type {
  McpToolDescriptor,
  SubAgentSpec,
  SkillSituation,
  CodeSkill,
} from '../index.js';

describe('Integration #1 — Subagent + Voyager library', () => {
  it('a subagent receives a typed skill-execution result from the parent', async () => {
    const lib = new VoyagerSkillLibrary();
    for (const s of BUILTIN_SKILLS) lib.register(s);
    const store = new StubEntityStore();
    const sit: SkillSituation = {
      description: 'late rent ticket needs the ladder',
      embedding: handleLateRentSkill.embedding,
      jurisdiction: 'KE',
      tenant_id: 't1',
    };
    const skillResult = await lib.executeFirstMatch({
      situation: sit,
      input: {
        tenant_id: 't1',
        lease_id: 'L-1',
        days_late: 12,
        preferred_channel: 'sms',
      },
      entity_store: store,
      correlation_id: 'int-1',
    });
    expect(skillResult.status).toBe('ok');

    const spec: SubAgentSpec = {
      name: 'drafter',
      description: 'Draft a tenant notice from a skill result.',
      allowed_tools: ['Read'],
      system_prompt: 'Draft a polite reminder.',
      max_turns: 3,
      isolated_context: true,
    };
    const runner = new InMemorySubAgentRunner({
      outputs: {
        drafter: (input) =>
          ({ draft: `Reminder built from ${JSON.stringify(input.structured_input)}` }) as unknown,
      },
    });
    const subRes = await spawnSubAgent({
      spec,
      input: {
        prompt: 'Draft a reminder',
        structured_input: skillResult.output,
        correlation_id: 'int-1',
      },
      runner,
    });
    expect(subRes.status).toBe('ok');
    expect(runner.invocations[0]?.structured_input).toBeDefined();
  });
});

describe('Integration #2 — Filesystem skills + allowlist + body load', () => {
  it('discovers, filters by allowlist, and loads body on demand', async () => {
    const fs = new InMemorySkillFileSystem();
    fs.addDir('/skills');
    fs.addFile(
      '/skills/handle-late-rent/SKILL.md',
      `---
name: handle-late-rent
description: A
when_to_use: [late]
allowed_tools: [Read]
jurisdiction_aware: true
---

Late rent body content.`
    );
    fs.addFile(
      '/skills/compile-weekly-report/SKILL.md',
      `---
name: compile-weekly-report
description: B
when_to_use: [friday]
allowed_tools: [Read]
jurisdiction_aware: false
---

Weekly report body content.`
    );
    const { skills } = await discoverSkills(fs, { platform_root: '/skills' });
    const { allowed, excluded } = applyAllowlist(skills, ['compile-weekly-report']);
    expect(allowed).toHaveLength(1);
    expect(excluded).toHaveLength(1);
    // Lazy body load only for allowed.
    const body = await fs.readFile(allowed[0]!.skill_md_path);
    expect(body).toContain('Weekly report body');
  });
});

describe('Integration #3 — MCP ToolSearch defers a big catalog', () => {
  it('cuts context for a 200-tool server while leaving small servers inline', () => {
    const reg = new McpToolRegistry();
    const big: ReadonlyArray<McpToolDescriptor> = Array.from({ length: 200 }, (_, i) => ({
      name: `mpesa__t${i}`,
      description: `mpesa tool number ${i}`,
      tags: ['payment', 'mpesa'],
      full_schema: { type: 'object', properties: {} },
    }));
    const small: ReadonlyArray<McpToolDescriptor> = Array.from({ length: 8 }, (_, i) => ({
      name: `slack__t${i}`,
      description: `slack tool number ${i}`,
      full_schema: { type: 'object', properties: {} },
    }));
    reg.registerServer('mpesa', big);
    reg.registerServer('slack', small);
    const proj = reg.projectContext();
    expect(proj.deferred).toHaveLength(1);
    expect(proj.inlined).toHaveLength(8);
    expect(proj.approx_tokens_saved).toBeGreaterThan(30_000);

    const res = reg.search({ query: 'mpesa t99' });
    expect(res.candidates[0]?.name).toBe('mpesa__t99');
    expect(res.elapsed_ms!).toBeLessThan(100);
  });
});

describe('Integration #4 — Voyager library quarantines a flaky skill end-to-end', () => {
  it('after 3 consecutive failures, the library skips the skill on retrieve', async () => {
    const lib = new VoyagerSkillLibrary();
    const flakySkill: Omit<
      CodeSkill,
      'success_count' | 'failure_count' | 'consecutive_failures' | 'quarantined'
    > = {
      id: 'flaky',
      name: 'flaky',
      description: 'often fails',
      embedding: handleLateRentSkill.embedding,
      jurisdiction: 'platform',
      code: {
        source: '',
        input_schema: {},
        output_schema: {},
        run: async () => {
          throw new Error('flake');
        },
      },
    };
    lib.register(flakySkill);
    const sit: SkillSituation = {
      description: 's',
      embedding: handleLateRentSkill.embedding,
      jurisdiction: 'platform',
      tenant_id: 't',
    };
    for (let i = 0; i < 3; i++) {
      await lib.executeFirstMatch({
        situation: sit,
        input: {},
        entity_store: new StubEntityStore(),
        correlation_id: `c${i}`,
      });
    }
    expect(lib.get('flaky')?.quarantined).toBe(true);
    const r4 = await lib.executeFirstMatch({
      situation: sit,
      input: {},
      entity_store: new StubEntityStore(),
      correlation_id: 'c-final',
    });
    expect(r4.error?.code).toBe('no_match');
  });
});

describe('Integration #5 — Jurisdiction gating end-to-end', () => {
  it('refuses to retrieve a KE-only skill into a TZ tenant context', async () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(prepareKraFilingSkill);
    const sit: SkillSituation = {
      description: 'monthly filing time',
      embedding: prepareKraFilingSkill.embedding,
      jurisdiction: 'TZ',
      tenant_id: 't-tz',
    };
    const r = await lib.executeFirstMatch({
      situation: sit,
      input: {},
      entity_store: new StubEntityStore(),
      correlation_id: 'c',
    });
    expect(r.error?.code).toBe('no_match');
  });

  it('allows the same skill into a KE tenant context', async () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(prepareKraFilingSkill);
    const store = new StubEntityStore();
    const sit: SkillSituation = {
      description: 'kra rental income monthly mri filing',
      embedding: prepareKraFilingSkill.embedding,
      jurisdiction: 'KE',
      tenant_id: 't-ke',
    };
    const r = await lib.executeFirstMatch({
      situation: sit,
      input: {
        period_yyyy_mm: '2026-04',
        payments: [
          { property_id: 'p1', amount: 100_000, currency: 'KES', payment_date: '2026-04-10' },
        ],
        mri_rate: 0.075,
      },
      entity_store: store,
      correlation_id: 'c',
    });
    expect(r.status).toBe('ok');
  });
});

describe('Integration #6 — Subagent isolation contract (negative test)', () => {
  it('subagent cannot see anything the parent did not explicitly pass', async () => {
    const parentSecret = 'PARENT-SHOULD-NOT-LEAK';
    void parentSecret; // parent-only constant; subagent should never see this
    const runner = new InMemorySubAgentRunner({
      outputs: { researcher: () => ({ ok: true }) },
    });
    const spec: SubAgentSpec = {
      name: 'researcher',
      description: 'Researcher.',
      allowed_tools: ['Read'],
      system_prompt: 'You are a researcher.',
      max_turns: 2,
      isolated_context: true,
    };
    await spawnSubAgent({
      spec,
      input: { prompt: 'just facts', correlation_id: 'c' },
      runner,
    });
    const inv = runner.invocations[0]!;
    // The runner sees only spec + prompt + structured_input.
    expect(JSON.stringify(inv)).not.toContain(parentSecret);
    // parent_history_seen is empty by construction.
    expect(inv.parent_history_seen).toEqual([]);
  });
});

describe('Integration #7 — Compile a new skill from traces, register, execute', () => {
  it('compiler -> library register -> execute path works end-to-end', async () => {
    const compiler = new EchoSkillCompiler();
    const proposal = await compiler.compile({
      description: 'echo any payload',
      traces: [{ input: { x: 1 }, expected_output: { echoed: { x: 1 } } }],
      proposed_id: 'echo-test',
      jurisdiction: 'platform',
      description_embedding: handleLateRentSkill.embedding,
    });
    const lib = new VoyagerSkillLibrary();
    lib.register({
      ...proposal.skill,
      success_count: 0,
      failure_count: 0,
      consecutive_failures: 0,
      quarantined: false,
    });
    const sit: SkillSituation = {
      description: 'echo time',
      embedding: handleLateRentSkill.embedding,
      jurisdiction: 'platform',
      tenant_id: 't',
    };
    const r = await lib.executeFirstMatch({
      situation: sit,
      input: { hello: 'world' },
      entity_store: new StubEntityStore(),
      correlation_id: 'c',
    });
    expect(r.status).toBe('ok');
    expect(JSON.stringify(r.output)).toContain('hello');
  });
});

describe('Integration #8 — Filesystem catalog + Voyager library coexist', () => {
  it('discovery + library together: built-ins in library, SKILL.md catalog from disk', async () => {
    const fs = new InMemorySkillFileSystem();
    fs.addDir('/skills');
    for (const s of BUILTIN_SKILLS) {
      fs.addFile(
        `/skills/${s.id}/SKILL.md`,
        `---
name: ${s.id}
description: ${s.description.replace(/\n/g, ' ')}
when_to_use:
  - placeholder
allowed_tools: [Read]
jurisdiction_aware: ${s.jurisdiction !== 'platform'}
---

body`
      );
    }
    const r = await discoverSkills(fs, { platform_root: '/skills' });
    expect(r.skills.map((x) => x.manifest.name).sort()).toEqual(
      BUILTIN_SKILLS.map((s) => s.id).sort()
    );

    // Mirror them into the Voyager library — the two systems are
    // intentionally independent: the catalog is a description-only
    // discovery surface; the library holds the executable code.
    const lib = new VoyagerSkillLibrary();
    for (const s of BUILTIN_SKILLS) lib.register(s);
    expect(lib.size()).toBe(BUILTIN_SKILLS.length);
  });
});
