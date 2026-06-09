/**
 * estate-mind-perception — unit tests for the live PERCEPTION source.
 *
 * Proves the missing-organ fix: `perceive()` reads the SIX domain measurements
 * the six default drives evaluate from the estate tables and maps each seeded
 * row to the expected `RecordEntityInput` observation — so the situational
 * model gets populated and the drives can actually breach (→ proactive nudges).
 *
 * The fake db matches on the literal SQL text of each reader's query (the same
 * `sqlTextOf` flatten the wiring test uses), returns seeded rows for the
 * matched table, and `[]` otherwise — so we can assert each drive in isolation
 * AND that an empty/erroring source degrades to no observation (never throws).
 */

import { describe, it, expect } from 'vitest';
import { createEstateMindPerception } from '../estate-mind-perception.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

const silentLogger: PinoLikeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Flatten a drizzle `sql`` ` object to its literal text (mirrors wiring test). */
function sqlTextOf(query: unknown): string {
  const chunks = (query as { queryChunks?: ReadonlyArray<unknown> })?.queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  const parts: string[] = [];
  for (const c of chunks) {
    const value = (c as { value?: unknown })?.value;
    if (Array.isArray(value)) parts.push(value.join(' '));
    else if (typeof value === 'string') parts.push(value);
  }
  return parts.join(' ');
}

/** Build a perception source over a text-matched fake db (identity runner). */
function perceptionOver(handler: (text: string) => unknown) {
  const db = {
    async execute(query: unknown): Promise<unknown> {
      return handler(sqlTextOf(query));
    },
  };
  return createEstateMindPerception({
    db,
    logger: silentLogger,
    runServiceRole: (fn) => fn(db),
    now: () => Date.UTC(2026, 0, 1), // fixed clock for deterministic day maths
  });
}

const NOW = Date.UTC(2026, 0, 1);
const TENANT = 'tenant-A';

describe('estate-mind-perception — maps each of the six drives', () => {
  it('cash → runwayDays from forecasts(cash_runway_d) latest mid', async () => {
    const src = perceptionOver((text) =>
      text.includes('FROM forecasts')
        ? [{ scope_id: 'co-1', mid: '12', low: '8', computed_at: '2026-01-01' }]
        : [],
    );
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    const cash = obs.find((o) => o.kind === 'cash');
    expect(cash).toMatchObject({
      tenantId: TENANT,
      entityId: 'co-1',
      kind: 'cash',
      attributes: { runwayDays: 12 },
    });
  });

  it('licence → renewalInDays from licences.expiry_date (active)', async () => {
    // expiry 10 days after the fixed clock → renewalInDays ≈ 10
    const expiry = new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString();
    const src = perceptionOver((text) =>
      text.includes('FROM licences')
        ? [{ id: 'lic-1', number: 'PML-99', mineral: 'Au', expiry_date: expiry }]
        : [],
    );
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    const lic = obs.find((o) => o.kind === 'licence');
    expect(lic).toMatchObject({
      entityId: 'lic-1',
      kind: 'licence',
      attributes: { renewalInDays: 10 },
    });
  });

  it('safety → openIncidents grouped by site from incidents', async () => {
    const src = perceptionOver((text) =>
      text.includes('FROM incidents')
        ? [{ site_id: 'site-1', open_count: '3' }]
        : [],
    );
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    const safety = obs.find((o) => o.kind === 'site');
    expect(safety).toMatchObject({
      entityId: 'site-1',
      kind: 'site',
      attributes: { openIncidents: 3 },
    });
  });

  it('offtake → offtakeCoverageRatio = signed / total from offtake_agreements', async () => {
    const src = perceptionOver((text) =>
      text.includes('FROM offtake_agreements')
        ? [{ total_kg: '1000', signed_kg: '600' }]
        : [],
    );
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    const offtake = obs.find((o) => o.kind === 'counterparty');
    expect(offtake).toMatchObject({
      entityId: 'estate',
      kind: 'counterparty',
      attributes: { offtakeCoverageRatio: 0.6 },
    });
  });

  it('arrears → overdueDays from licence_events(payment_due, overdue)', async () => {
    // due 20 days BEFORE the fixed clock → overdueDays ≈ 20
    const due = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const src = perceptionOver((text) =>
      text.includes('FROM licence_events')
        ? [{ id: 'evt-1', licence_id: 'lic-1', due_date: due }]
        : [],
    );
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    const arrears = obs.find((o) => o.kind === 'arrears');
    expect(arrears).toMatchObject({
      entityId: 'evt-1',
      kind: 'arrears',
      attributes: { overdueDays: 20 },
    });
  });

  it('equipment → healthScore from assets lifecycle status', async () => {
    const src = perceptionOver((text) =>
      text.includes('FROM assets')
        ? [
            { id: 'a-1', kind: 'excavator', make: 'CAT', model: '320', status: 'operational' },
            { id: 'a-2', kind: 'pump', make: '', model: '', status: 'broken' },
            { id: 'a-3', kind: 'truck', make: '', model: '', status: 'under_maintenance' },
          ]
        : [],
    );
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    const eq = obs.filter((o) => o.kind === 'equipment');
    expect(eq).toHaveLength(3);
    expect(eq.find((e) => e.entityId === 'a-1')?.attributes).toEqual({ healthScore: 1 });
    expect(eq.find((e) => e.entityId === 'a-2')?.attributes).toEqual({ healthScore: 0 });
    expect(eq.find((e) => e.entityId === 'a-3')?.attributes).toEqual({ healthScore: 0.4 });
  });

  it('returns all six drive observations together in one tick', async () => {
    const expiry = new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString();
    const due = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const src = perceptionOver((text) => {
      if (text.includes('FROM forecasts')) return [{ scope_id: 'co-1', mid: '5', low: null, computed_at: 'x' }];
      if (text.includes('FROM licences')) return [{ id: 'lic-1', number: 'PML-1', mineral: 'Au', expiry_date: expiry }];
      if (text.includes('FROM incidents')) return [{ site_id: 'site-1', open_count: '2' }];
      if (text.includes('FROM offtake_agreements')) return [{ total_kg: '100', signed_kg: '50' }];
      if (text.includes('FROM licence_events')) return [{ id: 'evt-1', licence_id: 'lic-1', due_date: due }];
      if (text.includes('FROM assets')) return [{ id: 'a-1', kind: 'pump', make: '', model: '', status: 'broken' }];
      return [];
    });
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    const kinds = new Set(obs.map((o) => o.kind));
    expect(kinds).toEqual(new Set(['cash', 'licence', 'site', 'counterparty', 'arrears', 'equipment']));
    expect(obs).toHaveLength(6);
  });
});

describe('estate-mind-perception — degrades gracefully (no observation, never throws)', () => {
  it('an empty estate yields zero observations', async () => {
    const src = perceptionOver(() => []);
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    expect(obs).toEqual([]);
  });

  it('a NULL db yields zero observations (supervisor stays a no-op)', async () => {
    const src = createEstateMindPerception({
      db: null,
      logger: silentLogger,
      runServiceRole: (fn) => fn({ async execute() { return []; } }),
    });
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    expect(obs).toEqual([]);
  });

  it('a missing tenantId yields zero observations', async () => {
    const src = perceptionOver(() => [{ scope_id: 'x', mid: '1' }]);
    const obs = await src.perceive({ tenantId: '', nowMs: NOW });
    expect(obs).toEqual([]);
  });

  it('one throwing table degrades only its own drive — others still observe', async () => {
    const src = perceptionOver((text) => {
      if (text.includes('FROM incidents')) throw new Error('relation "incidents" does not exist');
      if (text.includes('FROM assets')) return [{ id: 'a-1', kind: 'pump', make: '', model: '', status: 'operational' }];
      return [];
    });
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    // safety reader threw → no `site` observation, but equipment still mapped.
    expect(obs.some((o) => o.kind === 'site')).toBe(false);
    expect(obs.some((o) => o.kind === 'equipment')).toBe(true);
  });

  it('offtake with a zero-volume book yields no coverage signal (absence ≠ breach)', async () => {
    const src = perceptionOver((text) =>
      text.includes('FROM offtake_agreements') ? [{ total_kg: '0', signed_kg: '0' }] : [],
    );
    const obs = await src.perceive({ tenantId: TENANT, nowMs: NOW });
    expect(obs.some((o) => o.kind === 'counterparty')).toBe(false);
  });
});
