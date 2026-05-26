import { describe, expect, it } from 'vitest';
import { recognizeEntityType } from '../intent/entity-recognizer.js';
import { ENTITY_CONFIDENCE_FLOOR } from '../types.js';
import type { TabularSample } from '../types.js';

function makeSample(headers: ReadonlyArray<string>): TabularSample {
  return Object.freeze({
    source_file: { id: 'f1', name: 'test.xlsx' },
    headers: Object.freeze([...headers]),
    rows: Object.freeze([]),
    total_row_count: 0,
  });
}

describe('recognizeEntityType', () => {
  it('recognises a worker feed by NIDA + name + role columns', () => {
    const sample = makeSample(['NIDA', 'name', 'role', 'site']);
    const result = recognizeEntityType(sample, 'employees');
    expect(result.inferred_entity_type).toBe('worker');
    expect(result.entity_confidence).toBeGreaterThanOrEqual(
      ENTITY_CONFIDENCE_FLOOR,
    );
    expect(result.target_table).toBe('workers');
    expect(result.above_floor).toBe(true);
  });

  it('recognises a parcel feed by parcel_id + grade + weight', () => {
    const sample = makeSample(['parcel_id', 'grade', 'weight', 'site']);
    const result = recognizeEntityType(sample);
    expect(result.inferred_entity_type).toBe('parcel');
    expect(result.above_floor).toBe(true);
  });

  it('recognises a buyer feed', () => {
    const sample = makeSample([
      'buyer_id',
      'buyer_name',
      'kyb_status',
      'country',
    ]);
    const result = recognizeEntityType(sample, 'buyers');
    expect(result.inferred_entity_type).toBe('buyer');
  });

  it('falls below floor for ambiguous columns', () => {
    const sample = makeSample(['col_a', 'col_b', 'col_c']);
    const result = recognizeEntityType(sample);
    expect(result.entity_confidence).toBeLessThan(ENTITY_CONFIDENCE_FLOOR);
    expect(result.above_floor).toBe(false);
  });

  it('uses the intent hint to boost confidence', () => {
    const cols = ['NIDA', 'name'];
    const without_hint = recognizeEntityType(makeSample(cols));
    const with_hint = recognizeEntityType(makeSample(cols), 'employees');
    expect(with_hint.entity_confidence).toBeGreaterThanOrEqual(
      without_hint.entity_confidence,
    );
  });
});
