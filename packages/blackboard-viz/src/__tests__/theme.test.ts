import { describe, it, expect } from 'vitest';

import {
  tokenForKind,
  tokenForStatus,
  tokenForCursor,
  isValidThemeColor,
} from '../themes/blackboard-oklch';
import { KNOWLEDGE_STATES, REGION_STATUSES } from '../types';

describe('BLACKBOARD_OKLCH_THEME', () => {
  it('exposes the six knowledge-state tokens and they parse as OKLCH', () => {
    for (const ks of KNOWLEDGE_STATES) {
      const token = tokenForKind(ks);
      expect(token.oklch).toMatch(/^oklch\(/);
      expect(isValidThemeColor(token.oklch)).toBe(true);
    }
  });

  it('exposes the four status tokens and they parse as OKLCH', () => {
    for (const status of REGION_STATUSES) {
      const token = tokenForStatus(status);
      expect(token.oklch).toMatch(/^oklch\(/);
    }
  });

  it('picks a deterministic cursor color per user-id', () => {
    const a1 = tokenForCursor('user-1');
    const a2 = tokenForCursor('user-1');
    const b = tokenForCursor('user-2');
    expect(a1.oklch).toBe(a2.oklch);
    expect(b.oklch).toMatch(/^oklch\(/);
  });

  it('rejects raw RGB strings', () => {
    expect(isValidThemeColor('rgb(255, 0, 0)')).toBe(false);
    expect(isValidThemeColor('oklch(0.5 0.1 100)')).toBe(true);
    expect(isValidThemeColor('#AABBCC')).toBe(true);
  });
});
