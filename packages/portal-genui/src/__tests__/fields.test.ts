/**
 * Field-catalog tests.
 *
 *  - Every kind has metadata.
 *  - Every kind builds a validator that round-trips its mock value.
 *  - Bad inputs are rejected (the inverse).
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_FIELD_KINDS,
  FIELD_KIND_REGISTRY,
  buildFieldValueValidator,
  buildMockRecordForFields,
  getFieldKindMetadata,
} from '../fields/index.js';
import type { PortalTabField } from '../types.js';

function baseField(overrides: Partial<PortalTabField>): PortalTabField {
  return {
    key: overrides.key ?? 'k',
    label: overrides.label ?? 'L',
    kind: overrides.kind ?? 'text',
    required: true,
    ...overrides,
  } as PortalTabField;
}

describe('FIELD_KIND_REGISTRY', () => {
  it('has metadata for all 22 kinds', () => {
    expect(ALL_FIELD_KINDS.length).toBe(22);
    for (const k of ALL_FIELD_KINDS) {
      const meta = FIELD_KIND_REGISTRY[k];
      expect(meta).toBeDefined();
      expect(meta.rendererName).toBeTruthy();
      expect(meta.displayLabel).toBeTruthy();
    }
  });

  it('throws on unknown kind', () => {
    expect(() => getFieldKindMetadata('not_a_kind' as unknown as 'text')).toThrow();
  });
});

describe('buildFieldValueValidator — round-trips the mock value', () => {
  for (const kind of ALL_FIELD_KINDS) {
    if (kind === 'dropdown' || kind === 'multi_select') continue; // need options
    it(`round-trips mock for kind=${kind}`, () => {
      const meta = getFieldKindMetadata(kind);
      const field = baseField({ kind, key: `f_${kind}` });
      const validator = buildFieldValueValidator(field);
      expect(() => validator.parse(meta.mockValue)).not.toThrow();
    });
  }

  it('dropdown validator accepts an option value', () => {
    const field = baseField({
      kind: 'dropdown',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });
    const validator = buildFieldValueValidator(field);
    expect(validator.parse('a')).toBe('a');
    expect(() => validator.parse('c')).toThrow();
  });

  it('multi_select validator accepts a subset', () => {
    const field = baseField({
      kind: 'multi_select',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    });
    const validator = buildFieldValueValidator(field);
    expect(validator.parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(() => validator.parse(['a', 'z'])).toThrow();
  });
});

describe('buildFieldValueValidator — rejects bad input', () => {
  it('rejects non-numeric for number kind', () => {
    const v = buildFieldValueValidator(baseField({ kind: 'number' }));
    expect(() => v.parse('not a number')).toThrow();
  });

  it('respects min / max for number', () => {
    const v = buildFieldValueValidator(
      baseField({ kind: 'number', min: 0, max: 10 }),
    );
    expect(() => v.parse(11)).toThrow();
    expect(() => v.parse(-1)).toThrow();
    expect(v.parse(5)).toBe(5);
  });

  it('rejects malformed email', () => {
    const v = buildFieldValueValidator(baseField({ kind: 'email' }));
    expect(() => v.parse('not an email')).toThrow();
  });

  it('rejects non-iso datetime', () => {
    const v = buildFieldValueValidator(baseField({ kind: 'datetime' }));
    expect(() => v.parse('totally not a date')).toThrow();
  });

  it('rejects malformed phone', () => {
    const v = buildFieldValueValidator(baseField({ kind: 'phone_number' }));
    expect(() => v.parse('abc')).toThrow();
  });

  it('rejects malformed color', () => {
    const v = buildFieldValueValidator(baseField({ kind: 'color' }));
    expect(() => v.parse('blue')).toThrow();
  });

  it('rejects malformed url', () => {
    const v = buildFieldValueValidator(baseField({ kind: 'url' }));
    expect(() => v.parse('not a url')).toThrow();
  });

  it('rejects malformed address', () => {
    const v = buildFieldValueValidator(baseField({ kind: 'address_with_map' }));
    expect(() => v.parse({ address: 'x', lat: 999, lon: 0 })).toThrow();
  });

  it('treats `required: false` as optional', () => {
    const v = buildFieldValueValidator(
      baseField({ kind: 'text', required: false }),
    );
    // Optional fields accept null / undefined.
    expect(v.parse(undefined)).toBeUndefined();
    expect(v.parse(null)).toBeNull();
  });
});

describe('buildMockRecordForFields', () => {
  it('builds a record covering every field key', () => {
    const fields: PortalTabField[] = [
      baseField({ kind: 'text', key: 'a' }),
      baseField({ kind: 'number', key: 'b' }),
      baseField({ kind: 'email', key: 'c' }),
    ];
    const record = buildMockRecordForFields(fields);
    expect(Object.keys(record).sort()).toEqual(['a', 'b', 'c']);
  });
});
