import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SkillsRegistry } from '../skills/index.js';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('SkillsRegistry — file loading', () => {
  it('loads a single-file skill', async () => {
    const reg = new SkillsRegistry({ projectPath: fixturesRoot });
    const skill = await reg.getSkill('lease-renewal');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('lease-renewal');
    expect(skill?.description).toContain('lease');
    expect(skill?.allowedTools).toEqual(['Read', 'Bash']);
    expect(skill?.disableModelInvocation).toBe(false);
    expect(skill?.body).toContain('Lease renewal');
    expect(skill?.metadata).toEqual({ priority: 'high' });
  });

  it('returns undefined for unknown skill', async () => {
    const reg = new SkillsRegistry({ projectPath: fixturesRoot });
    expect(await reg.getSkill('not-real')).toBeUndefined();
  });

  it('listSkills returns the discovery-tier metadata only', async () => {
    const reg = new SkillsRegistry({ projectPath: fixturesRoot });
    const list = await reg.listSkills();
    const lease = list.find((s) => s.name === 'lease-renewal');
    expect(lease).toBeDefined();
    expect((lease as { body?: unknown }).body).toBeUndefined();
    expect(lease?.description).toContain('lease');
  });
});

describe('SkillsRegistry — programmatic', () => {
  it('registerSkill wins over a file skill of the same name', async () => {
    const reg = new SkillsRegistry({ projectPath: fixturesRoot });
    reg.registerSkill({
      name: 'lease-renewal',
      description: 'Programmatic override',
      body: 'OVERRIDDEN',
    });
    const skill = await reg.getSkill('lease-renewal');
    expect(skill?.description).toBe('Programmatic override');
    expect(skill?.body).toBe('OVERRIDDEN');
  });

  it('invokeSkill returns body when no invoker', async () => {
    const reg = new SkillsRegistry({ projectPath: fixturesRoot });
    const r = await reg.invokeSkill({ name: 'lease-renewal' });
    expect(typeof r.result).toBe('string');
    expect(r.result).toContain('Lease renewal');
  });

  it('invokeSkill runs programmatic invoker and passes input through', async () => {
    const reg = new SkillsRegistry({ projectPath: fixturesRoot });
    reg.registerSkill({
      name: 'echo',
      description: 'echo the input',
      invoke: async ({ input }) => ({ echoed: input }),
    });
    const r = await reg.invokeSkill({ name: 'echo', input: { foo: 'bar' } });
    expect(r.result).toEqual({ echoed: { foo: 'bar' } });
  });

  it('refuses to invoke when disable-model-invocation=true and no invoker', async () => {
    const reg = new SkillsRegistry({ projectPath: fixturesRoot });
    reg.registerSkill({
      name: 'no-model',
      description: 'cannot be invoked by model',
      disableModelInvocation: true,
      body: 'never seen',
    });
    await expect(reg.invokeSkill({ name: 'no-model' })).rejects.toThrow(/disable-model-invocation/);
  });
});
