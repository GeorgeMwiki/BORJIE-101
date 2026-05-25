/**
 * Sandbox Estate Generator — ephemeral demo estate per marketing session.
 *
 * Each prospect session gets a richer-than-demo estate: 24 units, 22
 * occupied, 3 arrears cases, 5 maintenance tickets, one active renewal,
 * one compliance notice. All data is in-memory, tagged to the ephemeral
 * session id (`mk_*`), and NEVER touches the production tenant database.
 *
 * Determinism: same session seed yields the same estate. Different seeds
 * produce disjoint data so one prospect's sandbox never sees another's.
 *
 * GC: sandboxes expire after 30 minutes of inactivity (see sandbox-store).
 */

import { z } from 'zod';

export const SANDBOX_TENANT_PREFIX = 'mk_sbx_' as const;

const SANDBOX_TTL_MINUTES = 30;

export const SandboxGenerateInputSchema = z.object({
  sessionId: z.string().min(1).max(120),
  country: z.enum(['KE', 'TZ', 'UG']).default('TZ'),
  now: z.date().optional(),
});
export type SandboxGenerateInput = z.infer<typeof SandboxGenerateInputSchema>;

export interface SandboxUnit {
  readonly id: string;
  readonly label: string;
  readonly bedrooms: number;
  readonly monthlyRent: number;
  readonly currency: 'KES' | 'TZS' | 'UGX';
  readonly occupied: boolean;
  readonly tenantId: string | null;
  readonly tenantName: string | null;
  readonly leaseStart: string;
  readonly leaseEnd: string;
}

export interface SandboxArrearsCase {
  readonly id: string;
  readonly unitId: string;
  readonly tenantName: string;
  readonly amountOutstanding: number;
  readonly daysLate: number;
  readonly lastPaidAt: string;
  readonly recommendedAction: 'reminder' | 'payment_plan' | 'legal_notice';
}

export interface SandboxMaintenanceTicket {
  readonly id: string;
  readonly unitId: string;
  readonly category: 'plumbing' | 'electrical' | 'structural' | 'appliance' | 'cleaning';
  readonly priority: 'low' | 'medium' | 'high' | 'emergency';
  readonly title: string;
  readonly reportedAt: string;
  readonly status: 'open' | 'assigned' | 'in_progress' | 'resolved';
  readonly assignedVendor: string | null;
}

export interface SandboxRenewal {
  readonly id: string;
  readonly unitId: string;
  readonly tenantName: string;
  readonly currentRent: number;
  readonly proposedRent: number;
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'declined';
}

export interface SandboxComplianceNotice {
  readonly id: string;
  readonly type: 'fire_safety' | 'water_quality' | 'tax_filing' | 'license_renewal';
  readonly severity: 'info' | 'warning' | 'critical';
  readonly title: string;
  readonly dueBy: string;
}

export interface SandboxEstate {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly estateName: string;
  readonly country: 'KE' | 'TZ' | 'UG';
  readonly currency: 'KES' | 'TZS' | 'UGX';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly units: readonly SandboxUnit[];
  readonly arrears: readonly SandboxArrearsCase[];
  readonly maintenance: readonly SandboxMaintenanceTicket[];
  readonly renewals: readonly SandboxRenewal[];
  readonly compliance: readonly SandboxComplianceNotice[];
}

const BASE_RENT_BY_COUNTRY = { KE: 26_000, TZ: 380_000, UG: 850_000 } as const;
const CURRENCY_BY_COUNTRY = { KE: 'KES', TZ: 'TZS', UG: 'UGX' } as const;
const ESTATE_PREFIX_BY_COUNTRY = {
  KE: 'Karen Estate',
  TZ: 'Mbezi Estate',
  UG: 'Kololo Estate',
} as const;

const SAMPLE_NAMES = [
  'Amina Hassan', 'Peter Otieno', 'Neema Mwakio', 'Daniel Kipchoge',
  'Grace Mutua', 'John Mwangi', 'Fatuma Said', 'Mariam Nakato',
  'James Ssempijja', 'Ruth Wanjiru', 'Issa Juma', 'Lydia Auma',
  'Kevin Maina', 'Hope Apolot', 'Zainabu Ally', 'Moses Kato',
  'Christine Njeri', 'Habiba Omary', 'Samuel Kigozi', 'Joy Akinyi',
  'Peter Mlimani', 'Asha Kimaro',
] as const;

const MAINT_TITLES = [
  'Leaking kitchen tap',
  'No hot water in master bathroom',
  'Ceiling fan making noise',
  'Main gate motor intermittent',
  'Patio tile cracked',
] as const;

const VENDORS = ['Majani Plumbing', 'Baraka Electrical', 'FundiPro', null, 'SafeHome Cleaners'] as const;

/** Deterministic pseudo-random from a string seed. */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Generate a deterministic sandbox estate for a given session. */
export function generateSandboxEstate(
  input: SandboxGenerateInput
): SandboxEstate {
  const parsed = SandboxGenerateInputSchema.parse(input);
  const now = parsed.now ?? new Date();
  const rand = seededRandom(parsed.sessionId);

  const country = parsed.country;
  const currency = CURRENCY_BY_COUNTRY[country];
  const baseRent = BASE_RENT_BY_COUNTRY[country];
  const tenantId = `${SANDBOX_TENANT_PREFIX}${parsed.sessionId}`;

  // ---------------- 24 units, 22 occupied, 2 vacant -----------------------
  const units: SandboxUnit[] = [];
  const vacantIdxs = new Set<number>();
  // Deterministically pick 2 vacant slots.
  vacantIdxs.add(Math.floor(rand() * 24));
  while (vacantIdxs.size < 2) vacantIdxs.add(Math.floor(rand() * 24));

  for (let i = 0; i < 24; i += 1) {
    const bedrooms = 1 + Math.floor(rand() * 4);
    const variance = 0.85 + rand() * 0.3;
    const monthlyRent = Math.round(baseRent * bedrooms * variance);
    const occupied = !vacantIdxs.has(i);
    const tenantName = occupied
      ? (SAMPLE_NAMES[Math.floor(rand() * SAMPLE_NAMES.length)] ?? 'Tenant')
      : null;
    const leaseStart = daysAgo(now, 60 + Math.floor(rand() * 500));
    const leaseEnd = daysFromNow(now, 30 + Math.floor(rand() * 330));
    units.push({
      id: `${parsed.sessionId}_u${i + 1}`,
      label: `Unit ${String.fromCharCode(65 + (i % 6))}${Math.floor(i / 6) + 1}`,
      bedrooms,
      monthlyRent,
      currency,
      occupied,
      tenantId: occupied ? `${parsed.sessionId}_t${i + 1}` : null,
      tenantName,
      leaseStart,
      leaseEnd,
    });
  }

  // ---------------- 3 arrears cases ---------------------------------------
  const occupiedUnits = units.filter((u) => u.occupied);
  const arrears: SandboxArrearsCase[] = [];
  const usedArrearsIdx = new Set<number>();
  while (arrears.length < 3 && arrears.length < occupiedUnits.length) {
    const idx = Math.floor(rand() * occupiedUnits.length);
    if (usedArrearsIdx.has(idx)) continue;
    usedArrearsIdx.add(idx);
    const u = occupiedUnits[idx];
    if (!u) continue;
    const daysLate = 12 + Math.floor(rand() * 55);
    const months = 1 + Math.floor(daysLate / 30);
    const action: SandboxArrearsCase['recommendedAction'] =
      daysLate < 20 ? 'reminder' : daysLate < 40 ? 'payment_plan' : 'legal_notice';
    arrears.push({
      id: `${parsed.sessionId}_ar${arrears.length + 1}`,
      unitId: u.id,
      tenantName: u.tenantName ?? 'Tenant',
      amountOutstanding: u.monthlyRent * months,
      daysLate,
      lastPaidAt: daysAgo(now, daysLate + 30),
      recommendedAction: action,
    });
  }

  // ---------------- 5 maintenance tickets ---------------------------------
  const maintenance: SandboxMaintenanceTicket[] = [];
  const maintCategories: SandboxMaintenanceTicket['category'][] = [
    'plumbing', 'electrical', 'structural', 'appliance', 'cleaning',
  ];
  for (let i = 0; i < 5; i += 1) {
    const uIdx = Math.floor(rand() * occupiedUnits.length);
    const u = occupiedUnits[uIdx];
    if (!u) continue;
    const priority: SandboxMaintenanceTicket['priority'] =
      i === 0 ? 'emergency' : i < 2 ? 'high' : i < 4 ? 'medium' : 'low';
    const status: SandboxMaintenanceTicket['status'] =
      i === 0 ? 'in_progress' : i < 3 ? 'assigned' : 'open';
    maintenance.push({
      id: `${parsed.sessionId}_m${i + 1}`,
      unitId: u.id,
      category: maintCategories[i] ?? 'plumbing',
      priority,
      title: MAINT_TITLES[i] ?? 'Maintenance request',
      reportedAt: daysAgo(now, 1 + Math.floor(rand() * 10)),
      status,
      assignedVendor: status === 'open' ? null : (VENDORS[i] ?? null),
    });
  }

  // ---------------- 1 active renewal --------------------------------------
  const renewalUnit = occupiedUnits[Math.floor(rand() * occupiedUnits.length)];
  const renewals: SandboxRenewal[] = [];
  if (renewalUnit) {
    renewals.push({
      id: `${parsed.sessionId}_r1`,
      unitId: renewalUnit.id,
      tenantName: renewalUnit.tenantName ?? 'Tenant',
      currentRent: renewalUnit.monthlyRent,
      proposedRent: Math.round(renewalUnit.monthlyRent * 1.07),
      expiresAt: daysFromNow(now, 21),
      status: 'pending',
    });
  }

  // ---------------- 1 compliance notice -----------------------------------
  const compliance: SandboxComplianceNotice[] = [
    {
      id: `${parsed.sessionId}_c1`,
      type: country === 'TZ' ? 'tax_filing' : country === 'KE' ? 'fire_safety' : 'license_renewal',
      severity: 'warning',
      title:
        country === 'TZ'
          ? 'TRA monthly VAT return due'
          : country === 'KE'
            ? 'Annual fire-safety inspection overdue by 9 days'
            : 'URSB property-management license renewal window opens',
      dueBy: daysFromNow(now, country === 'KE' ? -9 : 14),
    },
  ];

  return {
    sessionId: parsed.sessionId,
    tenantId,
    estateName: ESTATE_PREFIX_BY_COUNTRY[country],
    country,
    currency,
    createdAt: now.toISOString(),
    expiresAt: minutesFromNow(now, SANDBOX_TTL_MINUTES),
    units,
    arrears,
    maintenance,
    renewals,
    compliance,
  };
}

export function isSandboxTenantId(id: string): boolean {
  return id.startsWith(SANDBOX_TENANT_PREFIX);
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
function daysFromNow(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
function minutesFromNow(now: Date, mins: number): string {
  return new Date(now.getTime() + mins * 60_000).toISOString();
}
