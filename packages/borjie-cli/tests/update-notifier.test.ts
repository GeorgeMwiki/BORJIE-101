import { describe, expect, it } from 'vitest';
import { isNewer } from '../src/update-notifier.js';

describe('isNewer (semver-ish)', () => {
  it('detects major bumps', () => {
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });
  it('detects patch bumps', () => {
    expect(isNewer('0.2.1', '0.2.0')).toBe(true);
  });
  it('returns false for older versions', () => {
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });
  it('returns false for the same version', () => {
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
  });
  it('treats stable as newer than pre-release at same numeric', () => {
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true);
  });
});
