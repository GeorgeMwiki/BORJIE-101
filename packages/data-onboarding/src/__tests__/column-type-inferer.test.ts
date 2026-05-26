import { describe, expect, it } from 'vitest';
import { inferColumn } from '../discovery/column-type-inferer.js';

describe('inferColumn', () => {
  it('detects NIDA-shaped values', () => {
    const result = inferColumn({
      name: 'nida',
      values: [
        '19990321-12345-67890-12',
        '19880415-22345-67800-99',
        '19770101-32445-67000-44',
      ],
    });
    expect(result.inferred_type).toBe('nida');
    expect(result.cardinality).toBe('unique');
  });

  it('detects emails', () => {
    const result = inferColumn({
      name: 'email',
      values: ['a@b.com', 'c@d.com', 'e@f.com'],
    });
    expect(result.inferred_type).toBe('email');
  });

  it('detects boolean enums correctly', () => {
    const result = inferColumn({
      name: 'active',
      values: ['true', 'false', 'true', 'true', 'false'],
    });
    expect(result.inferred_type).toBe('boolean');
  });

  it('detects phone-shaped values', () => {
    const result = inferColumn({
      name: 'phone',
      values: ['+255 712 345 678', '+255 754 999 111', '+255 678 222 333'],
    });
    expect(result.inferred_type).toBe('phone');
  });

  it('marks low-cardinality columns as enum', () => {
    const result = inferColumn({
      name: 'role',
      values: ['driver', 'driller', 'manager', 'driver', 'driller', 'manager'],
    });
    expect(result.inferred_type).toBe('enum');
    expect(result.enum_values).toBeDefined();
    expect(result.cardinality).toBe('low');
  });

  it('records nullability', () => {
    const result = inferColumn({
      name: 'optional',
      values: ['x', '', 'y', ''],
    });
    expect(result.nullability).toBe(0.5);
  });

  it('returns string for empty columns', () => {
    const result = inferColumn({ name: 'empty', values: [] });
    expect(result.inferred_type).toBe('string');
    expect(result.cardinality).toBe('unknown');
  });

  it('detects ISO 8601 dates and datetimes', () => {
    const date_result = inferColumn({
      name: 'd',
      values: ['2026-05-01', '2026-05-02', '2026-05-03'],
    });
    expect(date_result.inferred_type).toBe('date');

    const dt_result = inferColumn({
      name: 'dt',
      values: ['2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'],
    });
    expect(dt_result.inferred_type).toBe('datetime');
  });
});
