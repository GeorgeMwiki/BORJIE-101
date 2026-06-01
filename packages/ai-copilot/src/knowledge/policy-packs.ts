/**
 * Policy Packs — per-country mining legal / compliance knowledge shipped
 * with the platform. Loaded on tenant creation (seeded via a one-shot
 * script) or looked up on-demand via `getPolicyPack(countryCode)`.
 *
 * This module hosts the summaries only. Full pack content lives in the
 * `@borjie/compliance-plugins` package; we cross-reference to avoid
 * duplicating the legal text. Summaries are deliberately high-level — the
 * authoritative figures (royalty rates, fee schedules) live in the plugin
 * packs and the intelligence corpus, which the Auditor cites against.
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
    title: 'Kenya mining regulatory pack',
    version: '2024.1',
    summary:
      'Covers the Mining Act 2016, the Mining (Use of Local Goods and Services) Regulations, the royalty regime administered by the State Department for Mining, and KRA mineral-income taxation.',
    keyReferences: [
      {
        section: 'Mining Act 2016 §183',
        heading: 'Royalties',
        summary:
          'Royalty is charged on the gross sales value of minerals at mineral-specific rates set by the Cabinet Secretary (e.g. gold and most metals around 5%); the holder declares and remits to the State Department for Mining.',
      },
      {
        section: 'Mining Act 2016 Part VIII',
        heading: 'Mineral rights & licences',
        summary:
          'Prospecting and mining are gated by prospecting licences, mining permits (artisanal / small-scale) and mining licences (large-scale); permits for artisanal operations are reserved for Kenyan citizens.',
      },
      {
        section: 'KRA mineral income',
        heading: 'Corporate tax & withholding',
        summary:
          'Mineral dealers and producers are taxed under the Income Tax Act; royalties to non-residents and service payments attract withholding tax; export of unprocessed minerals is regulated.',
      },
    ],
    tags: ['kenya', 'mining', 'royalty', 'kra'],
  },
  TZ: {
    countryCode: 'TZ',
    title: 'Tanzania mining regulatory pack',
    version: '2024.1',
    summary:
      'Covers the Mining Act 2010 as amended by the Written Laws (Miscellaneous Amendments) Act 2017, the royalty + inspection-fee regime, Mining Commission oversight, the State free-carried interest, local-content rules, and TRA taxation.',
    keyReferences: [
      {
        section: 'Mining Act 2010 §87 (as amended 2017)',
        heading: 'Royalty & inspection fee',
        summary:
          'Royalty is levied on the gross value of minerals — 6% for metallic minerals (gold, copper, silver) and gemstones, 3% for other minerals — plus a 1% clearing/inspection fee at the point of sale or export.',
      },
      {
        section: 'Mining Act 2010 §10 / §100',
        heading: 'Mineral rights & PML',
        summary:
          'Rights run from Primary Mining Licence (PML — reserved for Tanzanian citizens, 7 years renewable) through Mining Licence (ML) to Special Mining Licence (SML) for large-scale operations.',
      },
      {
        section: 'Written Laws 2017 — free-carried interest',
        heading: 'State participation & local content',
        summary:
          'The Government is entitled to a non-dilutable free-carried interest of not less than 16% in mining companies; local-content and beneficiation obligations apply to licence holders.',
      },
      {
        section: 'TRA',
        heading: 'Corporate tax, VAT & withholding',
        summary:
          'Corporate income tax is 30%; VAT, withholding and the GePG payment rail apply. Domestic mineral transactions are priced in TZS (GN 198/2025).',
      },
    ],
    tags: ['tanzania', 'mining', 'royalty', 'tra'],
  },
  UG: {
    countryCode: 'UG',
    title: 'Uganda mining regulatory pack',
    version: '2024.1',
    summary:
      'Covers the Mining and Minerals Act 2022, the royalty regime, the Directorate of Geological Survey and Mines (DGSM), and URA mineral taxation.',
    keyReferences: [
      {
        section: 'Mining and Minerals Act 2022 Part X',
        heading: 'Royalties & revenue sharing',
        summary:
          'Royalty is charged on the gross value of minerals at rates prescribed by regulation; royalty revenue is shared between central government, local government and lawful occupiers of the land.',
      },
      {
        section: 'Mining and Minerals Act 2022 Part IV',
        heading: 'Mineral rights',
        summary:
          'Licences span exploration, retention, mining (large-scale), small-scale mining and artisanal mining permits; artisanal rights are reserved for Ugandan citizens and registered associations.',
      },
      {
        section: 'URA',
        heading: 'Income tax & withholding',
        summary:
          'Mining income is taxed under the Income Tax Act with a ring-fenced mining regime; URA administers corporate tax, withholding and VAT on mineral dealings.',
      },
    ],
    tags: ['uganda', 'mining', 'royalty', 'ura'],
  },
  RW: {
    countryCode: 'RW',
    title: 'Rwanda mining regulatory pack',
    version: '2024.1',
    summary:
      'Covers Law N° 58/2018 on mining and quarry operations, the royalty regime administered by the Rwanda Mines, Petroleum and Gas Board (RMB), 3T/gold traceability (ITSCI), and RRA taxation.',
    keyReferences: [
      {
        section: 'Law 58/2018 Chapter IV',
        heading: 'Mineral licences',
        summary:
          'Operations require an exploration licence followed by a mining licence (large or small scale) or a quarry licence; licences are issued and supervised by the RMB.',
      },
      {
        section: 'RMB royalty regime',
        heading: 'Royalties & traceability',
        summary:
          'Royalty is charged on the value of minerals (notably the 3T minerals — tin, tantalum, tungsten — and gold); tagged traceability (ITSCI) and due-diligence reporting are mandatory for export.',
      },
      {
        section: 'RRA',
        heading: 'Income tax & withholding',
        summary:
          'Mineral income is taxed under the income tax law; RRA administers corporate tax, withholding and VAT on mineral sales and exports.',
      },
    ],
    tags: ['rwanda', 'mining', 'royalty', 'rmb'],
  },
};

export function getPolicyPack(countryCode: CountryCode): PolicyPack {
  return POLICY_PACKS[countryCode];
}

export function listPolicyPacks(): readonly PolicyPack[] {
  return Object.values(POLICY_PACKS);
}
