import { describe, expect, it } from 'vitest';
import {
  splitFrontmatter,
  toSkillManifest,
  SkillManifestParseError,
} from '../parse-manifest.js';

const validSource = `---
name: handle-late-rent
description: Walk a late-rent ticket through the ladder.
when_to_use:
  - tenant 5+ days late
  - missed rent
allowed_tools: [Read, Write]
jurisdiction_aware: true
code_entrypoint: ./handle-late-rent.skill.ts
version: 1.0.0
---

# Body

Markdown body here.`;

describe('splitFrontmatter', () => {
  it('separates a valid frontmatter from the body', () => {
    const { raw, body } = splitFrontmatter(validSource, 'test/SKILL.md');
    expect(raw['name']).toBe('handle-late-rent');
    expect(body.startsWith('# Body')).toBe(true);
  });

  it('throws when no frontmatter is present', () => {
    expect(() => splitFrontmatter('no frontmatter here', 'test/SKILL.md')).toThrow(
      SkillManifestParseError
    );
  });

  it('throws when the closing --- is missing', () => {
    expect(() => splitFrontmatter('---\nname: x\n', 'test/SKILL.md')).toThrow(
      /not closed/
    );
  });

  it('parses inline arrays', () => {
    const src = `---\nallowed_tools: [Read, Write, Grep]\n---\n\nbody`;
    const { raw } = splitFrontmatter(src, 't');
    expect(raw['allowed_tools']).toEqual(['Read', 'Write', 'Grep']);
  });

  it('parses block arrays', () => {
    const src = `---\nwhen_to_use:\n  - one\n  - two\n  - three\n---\n`;
    const { raw } = splitFrontmatter(src, 't');
    expect(raw['when_to_use']).toEqual(['one', 'two', 'three']);
  });

  it('parses booleans + numbers', () => {
    const src = `---\nflag: true\nother: false\nrate: 0.075\n---\n`;
    const { raw } = splitFrontmatter(src, 't');
    expect(raw['flag']).toBe(true);
    expect(raw['other']).toBe(false);
    expect(raw['rate']).toBe(0.075);
  });

  it('strips quotes from quoted strings', () => {
    const src = `---\nname: "quoted"\nother: 'singled'\n---\n`;
    const { raw } = splitFrontmatter(src, 't');
    expect(raw['name']).toBe('quoted');
    expect(raw['other']).toBe('singled');
  });

  it('handles empty inline arrays', () => {
    const src = `---\nfoo: []\n---\n`;
    const { raw } = splitFrontmatter(src, 't');
    expect(raw['foo']).toEqual([]);
  });
});

describe('toSkillManifest', () => {
  it('builds a typed manifest from valid frontmatter', () => {
    const { raw } = splitFrontmatter(validSource, 'p');
    const m = toSkillManifest(raw, 'p');
    expect(m.name).toBe('handle-late-rent');
    expect(m.jurisdiction_aware).toBe(true);
    expect(m.allowed_tools).toEqual(['Read', 'Write']);
    expect(m.code_entrypoint).toBe('./handle-late-rent.skill.ts');
    expect(m.version).toBe('1.0.0');
  });

  it('rejects a name that is not a slug', () => {
    expect(() =>
      toSkillManifest({ name: 'INVALID NAME', description: 'x', when_to_use: ['a'], allowed_tools: ['Read'], jurisdiction_aware: false }, 'p')
    ).toThrow(/must match/);
  });

  it('rejects empty when_to_use', () => {
    expect(() =>
      toSkillManifest(
        { name: 'x', description: 'y', when_to_use: [], allowed_tools: ['Read'], jurisdiction_aware: false },
        'p'
      )
    ).toThrow(/when_to_use must include/);
  });

  it('rejects empty allowed_tools', () => {
    expect(() =>
      toSkillManifest(
        { name: 'x', description: 'y', when_to_use: ['z'], allowed_tools: [], jurisdiction_aware: false },
        'p'
      )
    ).toThrow(/allowed_tools cannot be empty/);
  });

  it('rejects Agent in allowed_tools (skills are not subagents)', () => {
    expect(() =>
      toSkillManifest(
        { name: 'x', description: 'y', when_to_use: ['z'], allowed_tools: ['Read', 'Agent'], jurisdiction_aware: false },
        'p'
      )
    ).toThrow(/skill cannot grant "Agent"/);
  });

  it('rejects Task in allowed_tools', () => {
    expect(() =>
      toSkillManifest(
        { name: 'x', description: 'y', when_to_use: ['z'], allowed_tools: ['Read', 'Task'], jurisdiction_aware: false },
        'p'
      )
    ).toThrow(/skill cannot grant "Task"/);
  });

  it('rejects code_entrypoint with .. path escape', () => {
    expect(() =>
      toSkillManifest(
        {
          name: 'x',
          description: 'y',
          when_to_use: ['z'],
          allowed_tools: ['Read'],
          jurisdiction_aware: false,
          code_entrypoint: '../escape.ts',
        },
        'p'
      )
    ).toThrow(/cannot contain ".."/);
  });

  it('omits optional fields when absent', () => {
    const m = toSkillManifest(
      {
        name: 'x',
        description: 'y',
        when_to_use: ['z'],
        allowed_tools: ['Read'],
        jurisdiction_aware: false,
      },
      'p'
    );
    expect(m.code_entrypoint).toBeUndefined();
    expect(m.version).toBeUndefined();
  });

  it('rejects jurisdiction_aware that is not a boolean', () => {
    expect(() =>
      toSkillManifest(
        {
          name: 'x',
          description: 'y',
          when_to_use: ['z'],
          allowed_tools: ['Read'],
          jurisdiction_aware: 'yes',
        } as unknown as Record<string, unknown>,
        'p'
      )
    ).toThrow(/jurisdiction_aware/);
  });

  it('rejects non-string entries in when_to_use', () => {
    expect(() =>
      toSkillManifest(
        {
          name: 'x',
          description: 'y',
          when_to_use: [1, 2],
          allowed_tools: ['Read'],
          jurisdiction_aware: false,
        } as unknown as Record<string, unknown>,
        'p'
      )
    ).toThrow(/list of non-empty strings/);
  });
});
