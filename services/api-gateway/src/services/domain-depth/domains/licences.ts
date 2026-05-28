/**
 * Licences — 8 sub-areas covering the full operating-licence portfolio.
 *
 * Now ONE domain among fourteen rather than the catch-all the home tab
 * used to default to.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 10.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'mining_titles',
    label: { en: 'Mining titles (PML, ML, SML)', sw: 'Hati za madini' },
    regulator: 'Mining Commission of Tanzania',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Operating without a current PML, ML or SML is a criminal offence under the Mining Act 2010.',
      sw: 'Kufanya kazi bila PML, ML au SML ya sasa ni kosa la jinai.',
    },
    dataResolverKey: 'licences.mining_titles',
  },
  {
    id: 'environmental_clearance',
    label: { en: 'Environmental clearance (EIA, EMP)', sw: 'Idhini ya mazingira' },
    regulator: 'National Environment Management Council (NEMC)',
    cadence: 'multi-year',
    riskIfMissed: {
      en: 'Without a current EIA decision letter the Mining Commission cannot endorse renewal.',
      sw: 'Bila EIA, Tume ya Madini haiwezi kuthibitisha upyaji.',
    },
    dataResolverKey: 'licences.environmental_clearance',
  },
  {
    id: 'water_permits',
    label: { en: 'Water permits (Basin Water Boards)', sw: 'Vibali vya maji' },
    regulator: 'Basin Water Boards',
    cadence: 'multi-year',
    riskIfMissed: {
      en: 'Operating without a water-use permit is an offence under the Water Resources Management Act 2009.',
      sw: 'Kufanya kazi bila kibali cha maji ni kosa.',
    },
    dataResolverKey: 'licences.water_permits',
  },
  {
    id: 'explosives_licences',
    label: { en: 'Explosives licences (Police, Mining Commission)', sw: 'Leseni za milipuko' },
    regulator: 'Tanzania Police, Mining Commission',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Unlicensed explosives storage triggers criminal liability for directors.',
      sw: 'Kuhifadhi milipuko bila leseni kunaleta dhima ya jinai.',
    },
    dataResolverKey: 'licences.explosives_licences',
  },
  {
    id: 'workplace_registration',
    label: { en: 'Workplace registration (OSHA, per site)', sw: 'Usajili wa eneo la kazi' },
    regulator: 'Occupational Safety and Health Authority (OSHA)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Operating without an OSHA workplace certificate is a strict-liability offence.',
      sw: 'Kufanya kazi bila cheti cha OSHA ni kosa la dhima ya moja kwa moja.',
    },
    dataResolverKey: 'licences.workplace_registration',
  },
  {
    id: 'business_licences',
    label: { en: 'Business licences (district, trading)', sw: 'Leseni za biashara' },
    regulator: 'BRELA, local government',
    cadence: 'annual',
    riskIfMissed: {
      en: 'A lapsed district business licence stops invoicing and banking.',
      sw: 'Leseni ya biashara ya wilaya iliyokwisha inazuia kufanya biashara.',
    },
    dataResolverKey: 'licences.business_licences',
  },
  {
    id: 'sectoral_permits',
    label: { en: 'Sectoral permits (fuel storage, hazardous chemicals, radiation)', sw: 'Vibali maalum' },
    regulator: 'TAEC, TBS',
    cadence: 'multi-year',
    riskIfMissed: {
      en: 'Storing diesel above the threshold without a permit is a TAEC offence.',
      sw: 'Kuhifadhi dizeli juu ya kiwango bila kibali ni kosa.',
    },
    dataResolverKey: 'licences.sectoral_permits',
  },
  {
    id: 'export_licences',
    label: { en: 'Export licences (BoT gold-window, TRA mineral exporter)', sw: 'Leseni za usafirishaji' },
    regulator: 'BoT, TRA',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Without a current BoT gold-window licence, USD repatriation must use unlicensed channels.',
      sw: 'Bila leseni ya dirisha la dhahabu la BoT, USD lazima itumie njia zisizoidhinishwa.',
    },
    dataResolverKey: 'licences.export_licences',
  },
]);

export const LICENCES_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'licences',
  label: { en: 'Licences', sw: 'Leseni' },
  headline: {
    en: 'Full operating-licence portfolio: 8 sub-areas across mining, environment, water, explosives.',
    sw: 'Picha kamili ya leseni: maeneo 8.',
  },
  subAreas: SUB_AREAS,
});
