/**
 * Asset register — 9 sub-areas covering the full fixed-asset and
 * inventory footprint.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 14.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'fixed_assets',
    label: { en: 'Fixed assets (plant, equipment, buildings, NBV)', sw: 'Mali zisizohamishika' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A drifting NBV distorts depreciation expense and tax provisioning.',
      sw: 'NBV inayobadilika inapotosha gharama ya mwaka.',
    },
    dataResolverKey: 'asset_register.fixed_assets',
  },
  {
    id: 'heavy_mobile_equipment',
    label: { en: 'Heavy mobile equipment (excavators, trucks, dozers)', sw: 'Vifaa vizito vinavyohama' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Unmapped equipment makes maintenance scheduling impossible.',
      sw: 'Vifaa visivyoonyeshwa vinazuia ratiba ya matengenezo.',
    },
    dataResolverKey: 'asset_register.heavy_mobile_equipment',
  },
  {
    id: 'light_equipment',
    label: { en: 'Light equipment (generators, pumps, drills)', sw: 'Vifaa vidogo' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Generator failures stop the camp; pump failures stop the pit.',
      sw: 'Jenereta inazima kambi; pampu inazima shimo.',
    },
    dataResolverKey: 'asset_register.light_equipment',
  },
  {
    id: 'it_ot_assets',
    label: { en: 'IT and OT assets (servers, SCADA, biometric)', sw: 'IT na OT' },
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Unmonitored OT assets are the leading vector for ransomware on mining sites.',
      sw: 'Vifaa vya OT visivyofuatiliwa ni njia kuu ya ransomware.',
    },
    dataResolverKey: 'asset_register.it_ot_assets',
  },
  {
    id: 'land_surface_rights',
    label: { en: 'Land and surface rights', sw: 'Ardhi na haki za uso' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Title disputes are the slowest-moving and most expensive risk in mining.',
      sw: 'Migogoro ya hati ni hatari ya polepole na ya gharama zaidi.',
    },
    dataResolverKey: 'asset_register.land_surface_rights',
  },
  {
    id: 'bullion_dore_inventory',
    label: { en: 'Bullion and dore inventory (refinery, transit, vault)', sw: 'Hifadhi ya dhahabu na dore' },
    cadence: 'per-event',
    riskIfMissed: {
      en: 'Untracked dore in transit is a security and tax risk.',
      sw: 'Dore isiyofuatiliwa ni hatari ya usalama na kodi.',
    },
    dataResolverKey: 'asset_register.bullion_dore_inventory',
  },
  {
    id: 'ore_stockpile',
    label: { en: 'Ore stockpile (in-pit, ROM pad, plant feed, LG)', sw: 'Mafusho ya ore' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Mis-valued stockpile distorts EBITDA and inventory days.',
      sw: 'Mafusho yenye thamani potofu yanapotosha EBITDA.',
    },
    dataResolverKey: 'asset_register.ore_stockpile',
  },
  {
    id: 'consumables_stock',
    label: { en: 'Consumables stock (fuel, explosives, reagents, PPE)', sw: 'Hifadhi ya vinavyotumika' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'A reagent stock-out can halt the plant for days.',
      sw: 'Ukosefu wa reagent unaweza kuzima kiwanda kwa siku.',
    },
    dataResolverKey: 'asset_register.consumables_stock',
  },
  {
    id: 'insured_asset_reconciliation',
    label: { en: 'Insured-asset reconciliation (register vs policy)', sw: 'Ulinganisho wa mali na bima' },
    regulator: 'Tanzania Insurance Regulatory Authority (TIRA)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'An uninsured asset that fails is a full P&L hit.',
      sw: 'Mali bila bima inayoharibika ni hasara kamili.',
    },
    dataResolverKey: 'asset_register.insured_asset_reconciliation',
  },
]);

export const ASSET_REGISTER_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'asset-register',
  label: { en: 'Asset register', sw: 'Rejesta ya mali' },
  headline: {
    en: 'Full asset and inventory picture: 9 sub-areas from plant to consumables.',
    sw: 'Picha kamili ya mali: maeneo 9.',
  },
  subAreas: SUB_AREAS,
});
