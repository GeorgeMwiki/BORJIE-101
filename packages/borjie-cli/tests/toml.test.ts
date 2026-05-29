import { describe, expect, it } from 'vitest';
import { parseToml, stringifyToml } from '../src/toml.js';

describe('toml mini parser', () => {
  it('round-trips a basic doc', () => {
    const doc = {
      _: {},
      defaults: { lang: 'sw', color: true, profile: 'default' },
      update_check: { enabled: true },
    };
    const text = stringifyToml(doc);
    const reparsed = parseToml(text);
    expect(reparsed['defaults']?.['lang']).toBe('sw');
    expect(reparsed['defaults']?.['color']).toBe(true);
    expect(reparsed['update_check']?.['enabled']).toBe(true);
  });

  it('parses numbers and booleans', () => {
    const doc = parseToml(`[a]\nn = 42\nflag = false\n`);
    expect(doc['a']?.['n']).toBe(42);
    expect(doc['a']?.['flag']).toBe(false);
  });

  it('ignores comments + blank lines', () => {
    const doc = parseToml(`# hello\n[a]\n# inner comment\nx = "y"\n`);
    expect(doc['a']?.['x']).toBe('y');
  });

  it('rejects malformed lines', () => {
    expect(() => parseToml('no equals')).toThrow();
    expect(() => parseToml('[bad name!]')).toThrow();
  });
});
