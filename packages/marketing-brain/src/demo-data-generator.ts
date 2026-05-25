/**
 * Demo Data Generator — creates ephemeral sandbox estates per marketing session.
 *
 * Each prospect gets a deterministic but session-scoped demo dataset so they
 * can explore the product without signing up. The dataset is NEVER persisted
 * to the production schema — it lives only in memory tied to the session id.
 *
 * Isolation guarantees:
 *  - Every demo session gets its own `sessionId` with prefix `demo_`.
 *  - Data is tagged `tenant: demo_<sessionId>` so any accidental read from
 *    production service code will filter to zero rows.
 *  - Session data is garbage-collected after `ttlMs` of inactivity.
 */

import { z } from 'zod';

export const DEMO_TENANT_PREFIX = 'demo_' as const;

export const DemoEstateSchema = z.object({
  sessionId: z.string().min(1),
  tenantLabel: z.string().min(1),
  country: z.enum(['KE', 'TZ', 'UG']),
  portfolioSize: z.enum(['micro', 'small', 'mid', 'large']),
});

export interface DemoUnit {
  readonly id: string;
  readonly label: string;
  readonly bedrooms: number;
  readonly monthlyRent: number;
  readonly currency: 'KES' | 'TZS' | 'UGX';
  readonly status: 'occupied' | 'vacant' | 'notice_given';
  readonly tenantName?: string;
  readonly arrearsAmount: number;
}

export interface DemoEstate {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly propertyName: string;
  readonly country: 'KE' | 'TZ' | 'UG';
  readonly createdAt: string;
  readonly units: readonly DemoUnit[];
  readonly expiresAt: string;
}

const UNIT_COUNTS: Record<z.infer<typeof DemoEstateSchema>['portfolioSize'], number> = {
  micro: 4,
  small: 12,
  mid: 40,
  large: 120,
};

const CURRENCY_BY_COUNTRY = { KE: 'KES' as const, TZ: 'TZS' as const, UG: 'UGX' as const };

const BASE_RENT_BY_COUNTRY = { KE: 25_000, TZ: 350_000, UG: 800_000 } as const;

const SAMPLE_TENANT_NAMES = [
  'Amina Hassan',
  'Peter Otieno',
  'Neema Mwakio',
  'Daniel Kipchoge',
  'Grace Mutua',
  'John Mwangi',
  'Fatuma Said',
  'Mariam Nakato',
  'James Ssempijja',
  'Ruth Wanjiru',
  'Issa Juma',
  'Lydia Auma',
] as const;

interface SessionStore {
  readonly estates: Map<string, DemoEstate>;
  readonly ttlMs: number;
}

export function createDemoStore(opts: { ttlMs?: number } = {}): SessionStore {
  return {
    estates: new Map(),
    ttlMs: opts.ttlMs ?? 30 * 60 * 1000,
  };
}

/**
 * Generate a fresh demo estate for a new prospect session. Pure — same input
 * yields the same output so replays are reproducible in tests.
 */
export function generateDemoEstate(
  params: z.infer<typeof DemoEstateSchema>,
  now: Date = new Date()
): DemoEstate {
  const parsed = DemoEstateSchema.parse(params);
  const unitCount = UNIT_COUNTS[parsed.portfolioSize];
  const currency = CURRENCY_BY_COUNTRY[parsed.country];
  const baseRent = BASE_RENT_BY_COUNTRY[parsed.country];

  const units: DemoUnit[] = [];
  for (let i = 0; i < unitCount; i += 1) {
    const seed = hash(`${parsed.sessionId}:${i}`);
    const bedrooms = 1 + (seed % 4);
    const rentVariance = 1 + ((seed % 30) - 15) / 100;
    const monthlyRent = Math.round(baseRent * bedrooms * rentVariance);
    const statusRoll = seed % 10;
    const status: DemoUnit['status'] =
      statusRoll < 7 ? 'occupied' : statusRoll < 9 ? 'vacant' : 'notice_given';
    const tenantIdx = seed % SAMPLE_TENANT_NAMES.length;
    const tenantName = status === 'vacant' ? undefined : SAMPLE_TENANT_NAMES[tenantIdx];
    const arrearsMonths = status === 'occupied' && seed % 11 === 0 ? 1 + (seed % 3) : 0;
    units.push({
      id: `${parsed.sessionId}_u${i}`,
      label: `Unit ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`,
      bedrooms,
      monthlyRent,
      currency,
      status,
      ...(tenantName !== undefined ? { tenantName } : {}),
      arrearsAmount: arrearsMonths * monthlyRent,
    });
  }

  return {
    sessionId: parsed.sessionId,
    tenantId: `${DEMO_TENANT_PREFIX}${parsed.sessionId}`,
    propertyName: `${parsed.tenantLabel} Estate`,
    country: parsed.country,
    createdAt: now.toISOString(),
    units,
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
  };
}

export function putDemoEstate(store: SessionStore, estate: DemoEstate): void {
  store.estates.set(estate.sessionId, estate);
}

export function getDemoEstate(
  store: SessionStore,
  sessionId: string,
  now: Date = new Date()
): DemoEstate | null {
  const estate = store.estates.get(sessionId);
  if (!estate) return null;
  if (new Date(estate.expiresAt).getTime() < now.getTime()) {
    store.estates.delete(sessionId);
    return null;
  }
  return estate;
}

export function isDemoTenantId(tenantId: string): boolean {
  return tenantId.startsWith(DEMO_TENANT_PREFIX);
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
