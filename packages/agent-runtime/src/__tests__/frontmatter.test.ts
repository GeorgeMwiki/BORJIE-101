import { describe, expect, it } from 'vitest';

import { asStringList, parseFrontmatter } from '../frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns empty data and original body when no frontmatter', () => {
    const r = parseFrontmatter('# hello\n\nworld');
    expect(r.data).toEqual({});
    expect(r.body).toBe('# hello\n\nworld');
  });

  it('parses flat scalar keys', () => {
    const r = parseFrontmatter('---\nname: foo\ndescription: bar\n---\nbody');
    expect(r.data['name']).toBe('foo');
    expect(r.data['description']).toBe('bar');
    expect(r.body).toBe('body');
  });

  it('keeps scalars as strings (callers split via asStringList)', () => {
    const r = parseFrontmatter('---\ntools: Read, Write, Edit\n---\n');
    expect(r.data['tools']).toBe('Read, Write, Edit');
    expect(asStringList(r.data['tools'])).toEqual(['Read', 'Write', 'Edit']);
  });

  it('parses bullet lists', () => {
    const r = parseFrontmatter('---\nallowed-tools:\n  - Read\n  - Edit\n---\n');
    expect(r.data['allowed-tools']).toEqual(['Read', 'Edit']);
  });

  it('coerces booleans, integers, floats, null', () => {
    const r = parseFrontmatter(
      '---\nenabled: true\noff: false\nmax: 5\nrate: 1.5\nnone: null\n---\n',
    );
    expect(r.data['enabled']).toBe(true);
    expect(r.data['off']).toBe(false);
    expect(r.data['max']).toBe(5);
    expect(r.data['rate']).toBe(1.5);
    expect(r.data['none']).toBeNull();
  });

  it('handles quoted scalars with colons', () => {
    const r = parseFrontmatter('---\ndescription: "Has: a colon"\n---\n');
    expect(r.data['description']).toBe('Has: a colon');
  });
});

describe('asStringList', () => {
  it('returns undefined for nullish', () => {
    expect(asStringList(undefined)).toBeUndefined();
    expect(asStringList(null)).toBeUndefined();
  });
  it('normalises arrays', () => {
    expect(asStringList(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('splits comma strings', () => {
    expect(asStringList('a, b , c')).toEqual(['a', 'b', 'c']);
  });
  it('wraps single string', () => {
    expect(asStringList('a')).toEqual(['a']);
  });
});
