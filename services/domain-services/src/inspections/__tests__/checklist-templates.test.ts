/**
 * Inspection checklist template registry.
 */

import { describe, it, expect } from 'vitest';
import {
  MOVE_IN_CHECKLIST_TEMPLATE,
  MOVE_OUT_CHECKLIST_TEMPLATE,
  PERIODIC_CHECKLIST_TEMPLATE,
  MAINTENANCE_CHECKLIST_TEMPLATE,
  PRE_LISTING_CHECKLIST_TEMPLATE,
  INSPECTION_CHECKLIST_TEMPLATES,
  getChecklistTemplate,
} from '../checklist-templates.js';
import { INSPECTION_TYPES } from '../types.js';

describe('INSPECTION_CHECKLIST_TEMPLATES', () => {
  it('has a template for every inspection type', () => {
    for (const t of INSPECTION_TYPES) {
      expect(INSPECTION_CHECKLIST_TEMPLATES[t]).toBeDefined();
      expect(INSPECTION_CHECKLIST_TEMPLATES[t].type).toBe(t);
    }
  });

  it('every template has at least one room', () => {
    for (const t of INSPECTION_TYPES) {
      expect(INSPECTION_CHECKLIST_TEMPLATES[t].rooms.length).toBeGreaterThan(0);
    }
  });
});

describe('getChecklistTemplate', () => {
  it('returns move-in template for "move_in"', () => {
    expect(getChecklistTemplate('move_in')).toBe(MOVE_IN_CHECKLIST_TEMPLATE);
  });

  it('returns move-out template for "move_out"', () => {
    expect(getChecklistTemplate('move_out')).toBe(MOVE_OUT_CHECKLIST_TEMPLATE);
  });

  it('returns periodic template for "periodic"', () => {
    expect(getChecklistTemplate('periodic')).toBe(PERIODIC_CHECKLIST_TEMPLATE);
  });

  it('returns maintenance template for "maintenance"', () => {
    expect(getChecklistTemplate('maintenance')).toBe(
      MAINTENANCE_CHECKLIST_TEMPLATE,
    );
  });

  it('returns pre-listing template for "pre_listing"', () => {
    expect(getChecklistTemplate('pre_listing')).toBe(
      PRE_LISTING_CHECKLIST_TEMPLATE,
    );
  });
});

describe('Move-in checklist additionalItems', () => {
  it('includes meter readings + keys for deposit baseline', () => {
    const additional = MOVE_IN_CHECKLIST_TEMPLATE.additionalItems ?? [];
    expect(additional.some((i) => i.toLowerCase().includes('meter'))).toBe(
      true,
    );
    expect(additional.some((i) => i.toLowerCase().includes('keys'))).toBe(
      true,
    );
  });
});

describe('Move-out checklist additionalItems', () => {
  it('includes damage assessment and final meter readings', () => {
    const additional = MOVE_OUT_CHECKLIST_TEMPLATE.additionalItems ?? [];
    expect(additional.some((i) => i.toLowerCase().includes('damage'))).toBe(
      true,
    );
    expect(
      additional.some((i) => i.toLowerCase().includes('final meter')),
    ).toBe(true);
  });
});

describe('Periodic checklist additionalItems', () => {
  it('includes safety + compliance items', () => {
    const additional = PERIODIC_CHECKLIST_TEMPLATE.additionalItems ?? [];
    expect(additional.some((i) => i.toLowerCase().includes('smoke'))).toBe(
      true,
    );
  });
});
