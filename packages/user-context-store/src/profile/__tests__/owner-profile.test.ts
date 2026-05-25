import { describe, expect, it } from 'vitest';
import { buildOwnerProfile } from '../owner-profile.js';

type Rows = ReadonlyArray<Record<string, unknown>>;

function db(
  routes: ReadonlyArray<{ match: (sql: string) => boolean; rows: Rows; throw?: boolean }>,
): { execute(args: unknown): Promise<{ rows: Rows }> } {
  return {
    async execute(args: unknown) {
      const arg = args as { sql?: string };
      const sql = arg.sql ?? '';
      for (const r of routes) {
        if (r.match(sql)) {
          if (r.throw) throw new Error('missing-table');
          return { rows: r.rows };
        }
      }
      return { rows: [] };
    },
  };
}

describe('buildOwnerProfile', () => {
  it('returns minimal dossier with empty properties when DB empty', async () => {
    const profile = await buildOwnerProfile({
      userId: 'u1',
      tenantId: 't1',
      db: db([]),
    });
    expect(profile.identity.userId).toBe('u1');
    expect(profile.properties).toEqual([]);
  });

  it('loads properties with computed occupancy', async () => {
    const fake = db([
      {
        match: (sql) => sql.includes('FROM users'),
        rows: [{ first_name: 'Bob', last_name: 'Owner' }],
      },
      {
        match: (sql) => sql.includes('FROM properties p'),
        rows: [
          {
            id: 'p1',
            name: 'Prop One',
            default_currency: 'KES',
            total_units: 10,
            occupied_units: 8,
          },
        ],
      },
    ]);
    const profile = await buildOwnerProfile({
      userId: 'u1',
      tenantId: 't1',
      db: fake,
    });
    expect(profile.properties).toHaveLength(1);
    expect(profile.properties[0]?.occupancyPct).toBe(80);
  });

  it('graceful degrade when property_insurance missing', async () => {
    const fake = db([
      {
        match: (sql) => sql.includes('FROM properties p'),
        rows: [
          {
            id: 'p1',
            name: 'Prop One',
            default_currency: 'KES',
            total_units: 5,
            occupied_units: 5,
          },
        ],
      },
      {
        match: (sql) => sql.includes('property_insurance'),
        throw: true,
        rows: [],
      },
    ]);
    const profile = await buildOwnerProfile({
      userId: 'u1',
      tenantId: 't1',
      db: fake,
    });
    expect(profile.properties[0]?.insuranceExpiresAt).toBeUndefined();
  });
});
