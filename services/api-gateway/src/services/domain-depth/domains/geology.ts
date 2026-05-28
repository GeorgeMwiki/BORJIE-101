/**
 * Geology — 9 sub-areas covering the resource and reserve base.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 8.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'mineral_resource',
    label: { en: 'Mineral resource statement (measured, indicated, inferred)', sw: 'Taarifa ya rasilimali za madini' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Outdated resource statements distort investor valuation and lender terms.',
      sw: 'Taarifa za rasilimali zilizopitwa na wakati zinapotosha thamani.',
    },
    dataResolverKey: 'geology.mineral_resource',
  },
  {
    id: 'reserves',
    label: { en: 'Reserves (proven, probable, mine life)', sw: 'Hifadhi' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Falling mine life unspotted starves the next exploration budget.',
      sw: 'Maisha ya mgodi yanayoshuka yanawanyima utafiti.',
    },
    dataResolverKey: 'geology.reserves',
  },
  {
    id: 'drill_programme',
    label: { en: 'Drill programme (planned vs drilled, assay turnaround)', sw: 'Mpango wa kuchimba' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A drill rig sitting idle costs the same per month as a senior geologist for a year.',
      sw: 'Kifaa cha kuchimba kilichosimama kinagharimu sawa na mtaalamu kwa mwaka.',
    },
    dataResolverKey: 'geology.drill_programme',
  },
  {
    id: 'assay_backlog',
    label: { en: 'Assay backlog (SGS, Alex Stewart, Bureau Veritas)', sw: 'Bakizi ya uchunguzi' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Late assays delay the next mine plan and bury upside intersections.',
      sw: 'Uchunguzi wa kuchelewa unachelewesha mpango wa mgodi.',
    },
    dataResolverKey: 'geology.assay_backlog',
  },
  {
    id: 'grade_control',
    label: { en: 'Grade control (planned vs actual head grade)', sw: 'Udhibiti wa kiwango' },
    cadence: 'per-shift',
    riskIfMissed: {
      en: 'Grade drift between plan and pit is the leading indicator of dilution.',
      sw: 'Kutofautiana kati ya mpango na shimo ni dalili ya kupunguzwa.',
    },
    dataResolverKey: 'geology.grade_control',
  },
  {
    id: 'exploration_tenement',
    label: { en: 'Exploration tenement (prospecting, retention, lease)', sw: 'Eneo la utafiti' },
    regulator: 'Mining Commission of Tanzania',
    cadence: 'annual',
    riskIfMissed: {
      en: 'A lapsed prospecting licence forfeits the ground to a competitor.',
      sw: 'Leseni ya utafiti iliyokwisha inapoteza ardhi kwa mshindani.',
    },
    dataResolverKey: 'geology.exploration_tenement',
  },
  {
    id: 'geotechnical',
    label: { en: 'Geotechnical (pit-slope stability, ground support)', sw: 'Kijiotekniki' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A pit-slope failure can halt operations for weeks and harm workers.',
      sw: 'Kushindwa kwa mteremko wa shimo kunaweza kusimamisha kazi kwa wiki.',
    },
    dataResolverKey: 'geology.geotechnical',
  },
  {
    id: 'hydrology',
    label: { en: 'Hydrology (water table, dewatering, discharge)', sw: 'Maji' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'A rising water table can submerge a working bench in a single shift.',
      sw: 'Maji yanayoongezeka yanaweza kuzamisha sehemu ya kazi.',
    },
    dataResolverKey: 'geology.hydrology',
  },
  {
    id: 'depletion_ratio',
    label: { en: 'Resource depletion ratio (extraction vs additions)', sw: 'Uwiano wa kupungua kwa rasilimali' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Depleting faster than adding new resources is mining itself out of business.',
      sw: 'Kuchimba haraka kuliko kuongeza ni kufunga biashara.',
    },
    dataResolverKey: 'geology.depletion_ratio',
  },
]);

export const GEOLOGY_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'geology',
  label: { en: 'Geology', sw: 'Jiolojia' },
  headline: {
    en: 'Full resource picture: 9 sub-areas from resource statement to depletion ratio.',
    sw: 'Picha kamili ya rasilimali: maeneo 9.',
  },
  subAreas: SUB_AREAS,
});
