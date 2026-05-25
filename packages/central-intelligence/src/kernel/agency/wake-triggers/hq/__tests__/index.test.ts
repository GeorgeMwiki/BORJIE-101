/**
 * Tests for the HQ wake-triggers barrel — bundle-level invariants.
 */
import { describe, it, expect } from 'vitest';
import {
  createHqWakeTriggers,
  HQ_WAKE_TRIGGER_IDS,
} from '../index.js';

describe('createHqWakeTriggers', () => {
  it('returns all four HQ triggers in stable order', () => {
    const triggers = createHqWakeTriggers({});
    expect(triggers.map((t) => t.id)).toEqual(HQ_WAKE_TRIGGER_IDS);
  });

  it('every HQ trigger id is prefixed with hq.', () => {
    for (const id of HQ_WAKE_TRIGGER_IDS) {
      expect(id.startsWith('hq.')).toBe(true);
    }
  });

  it('triggers with no deps wired emit no goals (no-op)', async () => {
    const triggers = createHqWakeTriggers({});
    for (const t of triggers) {
      const goals = await t.detect({
        tenantId: 't1',
        clock: () => new Date('2026-05-15T00:00:00Z'),
      });
      expect(goals).toEqual([]);
    }
  });

  it('triggers retain their descriptions', () => {
    const triggers = createHqWakeTriggers({});
    for (const t of triggers) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.description.toLowerCase()).toContain('hq-tier');
    }
  });
});
