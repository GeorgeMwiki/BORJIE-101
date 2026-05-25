import { describe, it, expect } from 'vitest';
import {
  parseSkillManifest,
  loadSkill,
  executeSkill,
  SkillManifestError,
  type SkillFileReader,
} from '../skill.js';

const SAMPLE_SKILL = `---
name: monthly-arrears-chase
description: Compose the month-end arrears chase
when_to_use: When the user asks for arrears summaries
tools_allowed: [lookupTenantArrears, getMarketRateBand]
tier: pro
---
You will compose a polite chase email...`;

describe('parseSkillManifest', () => {
  it('parses every required field plus the body', () => {
    const m = parseSkillManifest(SAMPLE_SKILL);
    expect(m.name).toBe('monthly-arrears-chase');
    expect(m.description).toBe('Compose the month-end arrears chase');
    expect(m.whenToUse).toBe('When the user asks for arrears summaries');
    expect(m.toolsAllowed).toEqual([
      'lookupTenantArrears',
      'getMarketRateBand',
    ]);
    expect(m.tier).toBe('pro');
    expect(m.body).toMatch(/polite chase email/);
  });

  it('throws when the YAML delimiters are missing', () => {
    expect(() => parseSkillManifest('no frontmatter here')).toThrow(
      SkillManifestError,
    );
  });

  it('throws when a required field is absent', () => {
    expect(() =>
      parseSkillManifest(`---\ndescription: x\nwhen_to_use: y\n---\nbody`),
    ).toThrow(SkillManifestError);
  });

  it('rejects an unknown tier value', () => {
    expect(() =>
      parseSkillManifest(
        `---\nname: a\ndescription: b\nwhen_to_use: c\ntier: legendary\n---\nbody`,
      ),
    ).toThrow(SkillManifestError);
  });

  it('defaults toolsAllowed to an empty array', () => {
    const m = parseSkillManifest(
      `---\nname: a\ndescription: b\nwhen_to_use: c\n---\nbody`,
    );
    expect(m.toolsAllowed).toEqual([]);
  });
});

describe('loadSkill', () => {
  function readerFor(files: Record<string, string>): SkillFileReader {
    return {
      async read(path: string): Promise<string | null> {
        return files[path] ?? null;
      },
      async list(prefix: string): Promise<ReadonlyArray<string>> {
        return Object.keys(files).filter((k) => k.startsWith(prefix));
      },
    };
  }

  it('loads SKILL.md + prompt.md + code files', async () => {
    const reader = readerFor({
      'skills/x/SKILL.md': SAMPLE_SKILL,
      'skills/x/prompt.md': 'Compose the email body.',
      'skills/x/code/compose.ts': 'export const x = 1;',
    });
    const bundle = await loadSkill(reader, 'skills/x');
    expect(bundle.manifest.name).toBe('monthly-arrears-chase');
    expect(bundle.promptTemplate).toBe('Compose the email body.');
    expect(bundle.codeFiles).toHaveLength(1);
    expect(bundle.codeFiles[0]?.path).toBe('skills/x/code/compose.ts');
  });

  it('errors when SKILL.md is missing', async () => {
    const reader = readerFor({});
    await expect(loadSkill(reader, 'skills/missing')).rejects.toThrow(
      SkillManifestError,
    );
  });
});

describe('executeSkill', () => {
  it('invokes the injected LLM with the assembled system + body', async () => {
    const reader: SkillFileReader = {
      async read(p) {
        if (p === 'sk/SKILL.md') return SAMPLE_SKILL;
        if (p === 'sk/prompt.md') return 'PROMPT_TEMPLATE_BODY';
        return null;
      },
      async list() {
        return [];
      },
    };
    const bundle = await loadSkill(reader, 'sk');
    let captured = { system: '', user: '' };
    const result = await executeSkill(
      bundle,
      'user input here',
      {
        llm: async ({ system, user }) => {
          captured = { system, user };
          return { text: 'OK_RESPONSE' };
        },
        toolAllowed: () => true,
      },
      () => 1_000,
    );
    expect(result.output).toBe('OK_RESPONSE');
    expect(result.skillName).toBe('monthly-arrears-chase');
    expect(captured.user).toBe('user input here');
    expect(captured.system).toMatch(/monthly-arrears-chase/);
    expect(captured.system).toMatch(/PROMPT_TEMPLATE_BODY/);
  });

  it('throws when a disallowed tool appears in the manifest', async () => {
    const reader: SkillFileReader = {
      async read(p) {
        if (p === 'sk/SKILL.md') return SAMPLE_SKILL;
        return null;
      },
      async list() {
        return [];
      },
    };
    const bundle = await loadSkill(reader, 'sk');
    await expect(
      executeSkill(bundle, 'x', {
        llm: async () => ({ text: '' }),
        toolAllowed: (name) => name === 'lookupTenantArrears',
      }),
    ).rejects.toThrow(SkillManifestError);
  });
});
