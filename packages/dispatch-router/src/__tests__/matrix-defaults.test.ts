/**
 * Routing matrix tests — verify all 13 platform default rows are
 * well-formed and trigger for the expected (entity_type, intent) pairs.
 * (The four property-era ESTATE rows were excised for the mining product.)
 */

import { describe, it, expect } from 'vitest';
import {
  PLATFORM_ROUTING_MATRIX,
  PERSONA_TRUST_BY_TIER,
  GLOBAL_AUTO_APPLY_FLOOR,
  ROUTER_THRESHOLD,
} from '../matrix-defaults.js';
import { RoutingMatrixRowSchema } from '../types.js';

describe('PLATFORM_ROUTING_MATRIX', () => {
  it('contains exactly 13 rows', () => {
    expect(PLATFORM_ROUTING_MATRIX.length).toBe(13);
  });

  it('every row validates against the Zod schema', () => {
    for (const row of PLATFORM_ROUTING_MATRIX) {
      const parsed = RoutingMatrixRowSchema.safeParse(row);
      expect(parsed.success).toBe(true);
    }
  });

  it('every row has a unique id', () => {
    const ids = new Set(PLATFORM_ROUTING_MATRIX.map((r) => r.id));
    expect(ids.size).toBe(PLATFORM_ROUTING_MATRIX.length);
  });

  it('every id matches the stable L-ROW-NN format', () => {
    // Ids are STABLE identifiers, NOT positional — the excised ESTATE rows
    // (L-ROW-01..04) left a gap; surviving rows keep their original ids.
    for (const row of PLATFORM_ROUTING_MATRIX) {
      expect(row.id).toMatch(/^L-ROW-\d{2}$/);
    }
    // The first surviving row is the (formerly fifth) LITFIN row.
    expect(PLATFORM_ROUTING_MATRIX[0]?.id).toBe('L-ROW-05');
  });

  it('every row has min_confidence ≤ auto_apply_threshold', () => {
    for (const row of PLATFORM_ROUTING_MATRIX) {
      expect(row.min_confidence).toBeLessThanOrEqual(row.auto_apply_threshold);
    }
  });

  it('high-risk LITFIN open_arrears_case has min_approver_tier ≤ 2', () => {
    const row = PLATFORM_ROUTING_MATRIX.find(
      (r) =>
        r.module_template_id === 'LITFIN' && r.action === 'open_arrears_case',
    );
    expect(row).toBeDefined();
    expect(row?.min_approver_tier).toBeLessThanOrEqual(2);
  });

  it('TRC-EMU rules carry jurisdiction=TZ', () => {
    const trcRows = PLATFORM_ROUTING_MATRIX.filter(
      (r) => r.module_template_id === 'TRC-EMU',
    );
    expect(trcRows.length).toBeGreaterThan(0);
    for (const row of trcRows) {
      expect(row.jurisdiction).toBe('TZ');
    }
  });

  it('MAINTENANCE.open_maintenance_ticket requires HITL (high-stakes)', () => {
    const row = PLATFORM_ROUTING_MATRIX.find(
      (r) =>
        r.module_template_id === 'MAINTENANCE' &&
        r.action === 'open_maintenance_ticket',
    );
    expect(row).toBeDefined();
    expect(row?.hitl_required).toBe(true);
  });

  it('all rows have valid priority enum', () => {
    const valid = ['critical', 'high', 'medium', 'low'];
    for (const row of PLATFORM_ROUTING_MATRIX) {
      expect(valid).toContain(row.priority);
    }
  });
});

describe('PERSONA_TRUST_BY_TIER', () => {
  it('tier 1 (K-tier) has trust 1.0', () => {
    expect(PERSONA_TRUST_BY_TIER[1]).toBe(1.0);
  });

  it('tier 5 (V-tier) has the lowest trust', () => {
    expect(PERSONA_TRUST_BY_TIER[5]).toBeLessThan(0.5);
  });

  it('trust strictly decreases across tiers', () => {
    let prev = 1.1;
    for (let tier = 1; tier <= 5; tier++) {
      const v = PERSONA_TRUST_BY_TIER[tier];
      expect(v).toBeDefined();
      expect(v!).toBeLessThan(prev);
      prev = v!;
    }
  });
});

describe('thresholds', () => {
  it('ROUTER_THRESHOLD is below GLOBAL_AUTO_APPLY_FLOOR', () => {
    expect(ROUTER_THRESHOLD).toBeLessThan(GLOBAL_AUTO_APPLY_FLOOR);
  });
});
