/**
 * Tests for the concord-checker (Wave 19H).
 */

import { describe, it, expect } from 'vitest';
import {
  checkSubjectConcord,
  expectedSubjectConcord,
} from '../morphology/concord-checker.js';

describe('expectedSubjectConcord', () => {
  it('returns class 1/2 forms for animate nouns', () => {
    expect(expectedSubjectConcord(7, true, false)).toBe('a');
    expect(expectedSubjectConcord(7, true, true)).toBe('wa');
  });

  it('returns class-specific concord for inanimate nouns', () => {
    expect(expectedSubjectConcord(7, false, false)).toBe('ki');
    expect(expectedSubjectConcord(8, false, false)).toBe('vi');
    expect(expectedSubjectConcord(5, false, false)).toBe('li');
    expect(expectedSubjectConcord(6, false, false)).toBe('ya');
  });
});

describe('checkSubjectConcord', () => {
  it('passes — mtu amelala (cl. 1 + a-)', () => {
    const result = checkSubjectConcord('mtu', 'amelala');
    expect(result.pass).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('passes — kitabu kimeuzwa (cl. 7 + ki-)', () => {
    const result = checkSubjectConcord('kitabu', 'kimeuzwa');
    expect(result.pass).toBe(true);
  });

  it('flags class-mismatch — kitabu wameuza (cl. 7 + wa-)', () => {
    const result = checkSubjectConcord('kitabu', 'wameuza');
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    const v = result.violations[0];
    expect(v?.expected).toBe('ki');
    expect(v?.actual).toBe('wa');
  });

  it('flags animate-override-missed — kiongozi kimekuja', () => {
    const result = checkSubjectConcord('kiongozi', 'kimekuja');
    expect(result.pass).toBe(false);
    const v = result.violations[0];
    expect(v?.kind).toBe('animate-override-missed');
    expect(v?.expected).toBe('a');
  });
});
