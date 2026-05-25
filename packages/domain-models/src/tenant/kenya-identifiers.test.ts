import { describe, it, expect } from 'vitest';
import {
  isValidKraPin,
  KraPinSchema,
  isValidBrn,
  BrnSchema,
  KenyanComplianceIdentifiersSchema,
} from './kenya-identifiers.js';

describe('KRA PIN validation', () => {
  it('accepts the canonical A000000000B shape', () => {
    expect(isValidKraPin('A123456789B')).toBe(true);
    expect(isValidKraPin('P051234567K')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidKraPin('A12345B')).toBe(false); // too short
    expect(isValidKraPin('A1234567890B')).toBe(false); // too long
  });

  it('rejects digits in the letter positions', () => {
    expect(isValidKraPin('1123456789B')).toBe(false);
    expect(isValidKraPin('A1234567891')).toBe(false);
  });

  it('rejects letters in the digit block', () => {
    expect(isValidKraPin('A123456X89B')).toBe(false);
  });

  it('is case-insensitive at validator level (schema normalizes)', () => {
    // isValidKraPin uppercases internally.
    expect(isValidKraPin('a123456789b')).toBe(true);
  });

  it('schema transforms lowercase to uppercase', () => {
    const result = KraPinSchema.safeParse('a123456789b');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('A123456789B');
    }
  });

  it('schema rejects malformed input with a clear message', () => {
    const result = KraPinSchema.safeParse('A12345B');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /11 characters/.test(i.message))).toBe(true);
    }
  });
});

describe('BRN validation', () => {
  it('accepts the common shapes', () => {
    expect(isValidBrn('CPR/2019/123456')).toBe(true);
    expect(isValidBrn('PVT-ABC1234')).toBe(true);
    expect(isValidBrn('BN/2019/123456')).toBe(true);
    expect(isValidBrn('IP/2019/123')).toBe(true);
  });

  it('rejects too-short and too-long inputs', () => {
    expect(isValidBrn('ABC')).toBe(false);
    expect(isValidBrn('X'.repeat(50))).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(isValidBrn('CPR/2019@123')).toBe(false); // @
    expect(isValidBrn('ABC 123 456')).toBe(false); // internal space — schema strips but validator checks cleaned
  });

  it('schema strips whitespace and uppercases', () => {
    const result = BrnSchema.safeParse('  cpr/2019/123456  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('CPR/2019/123456');
    }
  });
});

describe('KenyanComplianceIdentifiersSchema', () => {
  it('accepts individual landlord with just PIN', () => {
    const result = KenyanComplianceIdentifiersSchema.safeParse({
      kraPin: 'A123456789B',
      entityType: 'individual',
    });
    expect(result.success).toBe(true);
  });

  it('requires BRN for company entities', () => {
    const result = KenyanComplianceIdentifiersSchema.safeParse({
      kraPin: 'A123456789B',
      entityType: 'company',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /BRN is required/.test(i.message))).toBe(true);
    }
  });

  it('accepts company entity when BRN is present', () => {
    const result = KenyanComplianceIdentifiersSchema.safeParse({
      kraPin: 'A123456789B',
      businessRegistrationNumber: 'CPR/2019/123456',
      entityType: 'company',
    });
    expect(result.success).toBe(true);
  });

  it('defaults entityType to individual when omitted', () => {
    const result = KenyanComplianceIdentifiersSchema.safeParse({
      kraPin: 'A123456789B',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entityType).toBe('individual');
    }
  });
});
