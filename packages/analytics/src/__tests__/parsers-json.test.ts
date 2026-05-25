import { describe, expect, it } from 'vitest';
import { parseJson } from '../parsers/index.js';

describe('parsers / parseJson', () => {
  it('parses a top-level array', () => {
    const rows = parseJson('[{"a":1},{"a":2}]');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('parses object wrapping array under arrayKey', () => {
    const rows = parseJson('{"data":[{"x":1}]}', { arrayKey: 'data' });
    expect(rows).toEqual([{ x: 1 }]);
  });

  it('parses NDJSON', () => {
    const rows = parseJson('{"a":1}\n{"a":2}\n', { format: 'ndjson' });
    expect(rows).toHaveLength(2);
  });

  it('rejects non-object NDJSON lines', () => {
    expect(() => parseJson('[1,2,3]\n', { format: 'ndjson' })).toThrow(/not an object/);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseJson('not json')).toThrow(/invalid JSON/);
  });

  it('rejects non-array root without arrayKey', () => {
    expect(() => parseJson('{"a":1}')).toThrow(/must be an array/);
  });

  it('rejects array element that is not an object', () => {
    expect(() => parseJson('[1,2,3]')).toThrow(/not an object/);
  });
});
