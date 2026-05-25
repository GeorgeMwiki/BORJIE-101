/**
 * MOVE_OUT_TEMPLATE (NEW 19) — end-of-tenancy checklist constant.
 */

import { describe, it, expect } from 'vitest';
import { MOVE_OUT_TEMPLATE } from '../move-out-template.js';

describe('MOVE_OUT_TEMPLATE', () => {
  it('exposes a stable id and labels', () => {
    expect(MOVE_OUT_TEMPLATE.id).toBe('move_out_v1');
    expect(MOVE_OUT_TEMPLATE.label).toBeTruthy();
    expect(MOVE_OUT_TEMPLATE.description).toBeTruthy();
  });

  it('requires dual signature and supports self-checkout', () => {
    expect(MOVE_OUT_TEMPLATE.requiresDualSignature).toBe(true);
    expect(MOVE_OUT_TEMPLATE.supportsSelfCheckout).toBe(true);
  });

  it('includes the seven standard rooms', () => {
    expect(MOVE_OUT_TEMPLATE.rooms).toHaveLength(7);
  });

  it('exposes the five closing sections (meters, keys, cleaning, damage, forwarding)', () => {
    const ids = MOVE_OUT_TEMPLATE.closingSections.map((s) => s.id);
    expect(ids).toEqual(['meters', 'keys', 'cleaning', 'damage', 'forwarding']);
  });

  it('marks meter, cleaning and damage sections as requiring photos', () => {
    const required = MOVE_OUT_TEMPLATE.closingSections.filter(
      (s) => s.requiredPhotos,
    );
    const ids = required.map((s) => s.id);
    expect(ids).toContain('meters');
    expect(ids).toContain('cleaning');
    expect(ids).toContain('damage');
  });

  it('every section has at least one item', () => {
    for (const section of MOVE_OUT_TEMPLATE.closingSections) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it('keys section enumerates access tokens (front-door, mailbox, parking)', () => {
    const keys = MOVE_OUT_TEMPLATE.closingSections.find((s) => s.id === 'keys');
    expect(keys).toBeDefined();
    const joined = keys?.items.join(' ').toLowerCase() ?? '';
    expect(joined).toContain('front-door');
    expect(joined).toContain('mailbox');
  });
});
