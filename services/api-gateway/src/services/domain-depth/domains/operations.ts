/**
 * Operations — 11 sub-areas covering the full pit-to-port physical flow.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 3.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'production',
    label: { en: 'Production (tonnage, head grade, recovery)', sw: 'Uzalishaji (tani, kiwango, urejeshaji)' },
    cadence: 'per-shift',
    riskIfMissed: {
      en: 'Falling head grade unspotted for two weeks erodes the quarterly forecast.',
      sw: 'Kushuka kwa kiwango kusiko ona kwa wiki mbili kunaathiri utabiri wa robo.',
    },
    dataResolverKey: 'operations.production',
  },
  {
    id: 'shifts_crew',
    label: { en: 'Shifts and crew', sw: 'Zamu na timu' },
    cadence: 'per-shift',
    riskIfMissed: {
      en: 'Under-staffed shifts lose tonnes; over-staffed shifts inflate opex.',
      sw: 'Zamu zenye wafanyakazi wachache zinapoteza tani.',
    },
    dataResolverKey: 'operations.shifts_crew',
  },
  {
    id: 'equipment_availability',
    label: { en: 'Equipment availability (excavators, trucks, drills)', sw: 'Upatikanaji wa vifaa' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'A breakdown unspotted for 12 hours stops the pit.',
      sw: 'Hitilafu isiyoonekana kwa saa 12 inazuia shimo.',
    },
    dataResolverKey: 'operations.equipment_availability',
  },
  {
    id: 'fuel',
    label: { en: 'Fuel consumption and bowser stock', sw: 'Matumizi ya mafuta' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'Theft variance silently drains 8-12% of the diesel budget.',
      sw: 'Wizi unapunguza 8-12% ya bajeti ya dizeli kimya kimya.',
    },
    dataResolverKey: 'operations.fuel',
  },
  {
    id: 'drill_blast',
    label: { en: 'Drill and blast performance', sw: 'Utendaji wa kuchimba na kulipua' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Poor fragmentation feeds the crusher costly oversize.',
      sw: 'Mvunjiko mbaya unalisha kifaa cha kuvunja vipande vikubwa vya gharama.',
    },
    dataResolverKey: 'operations.drill_blast',
  },
  {
    id: 'haulage',
    label: { en: 'Haulage cycle time', sw: 'Muda wa mzunguko wa usafirishaji' },
    cadence: 'per-shift',
    riskIfMissed: {
      en: 'Cycle-time creep is the single biggest hidden cost in open-pit operations.',
      sw: 'Kuongezeka kwa muda wa mzunguko ni gharama kubwa iliyofichwa.',
    },
    dataResolverKey: 'operations.haulage',
  },
  {
    id: 'processing_plant',
    label: { en: 'Processing plant (feed rate, recovery, reagents)', sw: 'Kiwanda cha usindikaji' },
    cadence: 'per-shift',
    riskIfMissed: {
      en: 'A 1% drop in recovery costs the same as a 1% drop in head grade.',
      sw: 'Kushuka kwa 1% ya urejeshaji ni hasara sawa na kushuka kwa kiwango.',
    },
    dataResolverKey: 'operations.processing_plant',
  },
  {
    id: 'tailings_storage',
    label: { en: 'Tailings storage (freeboard, decant, geotech)', sw: 'Hifadhi ya mabaki' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'A tailings dam failure is the single largest catastrophic risk in mining.',
      sw: 'Kushindwa kwa bwawa la mabaki ni hatari kubwa zaidi katika uchimbaji.',
    },
    dataResolverKey: 'operations.tailings_storage',
  },
  {
    id: 'logistics_transport',
    label: { en: 'Logistics and transport', sw: 'Usafirishaji' },
    cadence: 'per-shipment',
    riskIfMissed: {
      en: 'A delayed dore shipment ties up working capital and triggers buyer late fees.',
      sw: 'Mzigo wa dore uliochelewa unashika mtaji na kuleta ada za ucheleweshaji.',
    },
    dataResolverKey: 'operations.logistics_transport',
  },
  {
    id: 'incident_log',
    label: { en: 'Incident log (near-miss, LTI, fatality, spill)', sw: 'Rejesta ya ajali' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Unreported near-misses are leading indicators of the next lost-time injury.',
      sw: 'Ajali za karibu zisizoripotiwa ni dalili za majeruhi wanaofuata.',
    },
    dataResolverKey: 'operations.incident_log',
  },
  {
    id: 'maintenance',
    label: { en: 'Maintenance (PM compliance, spares)', sw: 'Matengenezo' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Skipping preventive maintenance turns into emergency breakdowns within months.',
      sw: 'Kuruka matengenezo ya kuzuia kunakuwa hitilafu za dharura ndani ya miezi.',
    },
    dataResolverKey: 'operations.maintenance',
  },
]);

export const OPERATIONS_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'operations',
  label: { en: 'Operations', sw: 'Shughuli' },
  headline: {
    en: 'Full pit-to-port operational picture: 11 sub-areas.',
    sw: 'Picha kamili ya shughuli kutoka shimo hadi bandari: maeneo 11.',
  },
  subAreas: SUB_AREAS,
});
