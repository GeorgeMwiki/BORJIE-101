/**
 * Policy Packs — per-country legal / compliance knowledge shipped with
 * the platform. Loaded on tenant creation (seeded via a one-shot script)
 * or looked up on-demand via `getPolicyPack(countryCode)`.
 *
 * This module hosts the summaries only. Full pack content lives in the
 * `@borjie/compliance-plugins` package; we cross-reference to avoid
 * duplicating the legal text.
 */

import { z } from 'zod';

export const CountryCodeSchema = z.enum(['KE', 'TZ', 'UG', 'RW']);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export interface PolicyPack {
  readonly countryCode: CountryCode;
  readonly title: string;
  readonly version: string;
  readonly summary: string;
  readonly keyReferences: ReadonlyArray<{
    readonly section: string;
    readonly heading: string;
    readonly summary: string;
  }>;
  readonly tags: readonly string[];
}

export const POLICY_PACKS: Record<CountryCode, PolicyPack> = {
  KE: {
    countryCode: 'KE',
    title: 'Kenya landlord-tenant pack',
    version: '2024.1',
    summary:
      'Covers the Landlord and Tenant (Shops, Hotels and Catering Establishments) Act, the Rent Restriction Act, and KRA monthly rental income rules.',
    keyReferences: [
      {
        section: 'LTA §4',
        heading: 'Notice to quit',
        summary:
          'For controlled tenancies, the landlord must serve a notice in the prescribed form 60 days before termination.',
      },
      {
        section: 'RRA §5',
        heading: 'Standard rent',
        summary:
          'Rent is regulated; any proposed increase must be filed with the Rent Tribunal for approval.',
      },
      {
        section: 'KRA MRI',
        heading: 'Monthly Rental Income',
        summary:
          'Residential rental income is taxed at 10% gross via the MRI regime; returns due by the 20th of the following month.',
      },
    ],
    tags: ['kenya', 'landlord-tenant', 'kra', 'mri'],
  },
  TZ: {
    countryCode: 'TZ',
    title: 'Tanzania landlord-tenant pack',
    version: '2024.1',
    summary:
      'Covers the Land Act, the Rent Restriction Act (repealed but referenced), and TRA rental income rules.',
    keyReferences: [
      {
        section: 'LA §88',
        heading: 'Form of lease',
        summary:
          'Leases over 12 months must be in writing; leases over 5 years must be registered at the Land Registry.',
      },
      {
        section: 'TRA Rental',
        heading: 'Withholding tax',
        summary:
          'Landlords must withhold 10% on rent paid by corporate tenants; residential rent is taxed at 15% net.',
      },
    ],
    tags: ['tanzania', 'landlord-tenant', 'tra'],
  },
  UG: {
    countryCode: 'UG',
    title: 'Uganda landlord-tenant pack',
    version: '2024.1',
    summary:
      'Covers the Landlord and Tenant Act 2022 and URA rental tax rules.',
    keyReferences: [
      {
        section: 'LTA 2022 §10',
        heading: 'Security deposit',
        summary:
          'Deposit capped at one month rent; must be refundable within 14 days of move-out less verified damages.',
      },
      {
        section: 'URA Rental',
        heading: 'Rental tax',
        summary:
          'Individual rental income tax is 12% of gross above UGX 2.82m annual threshold.',
      },
    ],
    tags: ['uganda', 'landlord-tenant', 'ura'],
  },
  RW: {
    countryCode: 'RW',
    title: 'Rwanda landlord-tenant pack',
    version: '2024.1',
    summary: 'Covers Law N° 30/2016 governing commercial leases and RRA rental tax rules.',
    keyReferences: [
      {
        section: 'Law 30/2016 Art. 8',
        heading: 'Lease duration',
        summary:
          'Default term is 3 years where not specified; written contract mandatory for any lease over 1 year.',
      },
      {
        section: 'RRA Rental',
        heading: 'Rental income tax',
        summary:
          'Flat 10% on gross rental income for individuals, 30% on net for companies.',
      },
    ],
    tags: ['rwanda', 'landlord-tenant', 'rra'],
  },
};

export function getPolicyPack(countryCode: CountryCode): PolicyPack {
  return POLICY_PACKS[countryCode];
}

export function listPolicyPacks(): readonly PolicyPack[] {
  return Object.values(POLICY_PACKS);
}
