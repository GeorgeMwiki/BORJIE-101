/**
 * Mining Licence Application — single-language label sets.
 *
 * EN/SW absolute toggle (CLAUDE.md hard rail): the builder selects ONE
 * dictionary by locale and injects it; the Typst template renders only
 * `data.labels.*`, so a document is physically incapable of mixing
 * languages. Both dictionaries are complete — no key may be EN-only.
 */

import type { DocLocale } from './data-schema.js';

export interface LicenceApplicationLabels {
  readonly title: string;
  readonly statuteLine: string;
  readonly commissionName: string;
  readonly reference: string;
  readonly date: string;
  readonly licenceTypePml: string;
  readonly licenceTypePl: string;
  readonly applicantIndividual: string;
  readonly applicantCompany: string;

  readonly secApplicant: string;
  readonly name: string;
  readonly applicantTypeLabel: string;
  readonly idTin: string;
  readonly nationality: string;
  readonly address: string;
  readonly companyRegNo: string;

  readonly secLicence: string;
  readonly licenceTypeLabel: string;
  readonly primaryMineral: string;
  readonly otherMinerals: string;
  readonly area: string;
  readonly hectares: string;
  readonly duration: string;
  readonly years: string;
  readonly region: string;
  readonly district: string;
  readonly ward: string;
  readonly locality: string;

  readonly secArea: string;
  readonly colBeacon: string;
  readonly colLatitude: string;
  readonly colLongitude: string;

  readonly secWork: string;
  readonly proposedExpenditure: string;
  readonly equipment: string;
  readonly estimatedJobs: string;

  readonly secFees: string;
  readonly applicationFee: string;
  readonly annualRentPerHa: string;
  readonly totalAnnualRent: string;
  readonly preparationFee: string;
  readonly totalPayable: string;

  readonly secDeclaration: string;
  readonly declarationBody: string;
  readonly submittedBy: string;
  readonly signature: string;

  readonly citationsTitle: string;
  readonly advisoryNote: string;
}

const EN: LicenceApplicationLabels = {
  title: 'Mining Licence Application',
  statuteLine: 'Submitted under the Mining Act, 2010',
  commissionName: 'Mining Commission of Tanzania (Tume ya Madini)',
  reference: 'Reference',
  date: 'Date',
  licenceTypePml: 'Primary Mining Licence (PML)',
  licenceTypePl: 'Prospecting Licence (PL)',
  applicantIndividual: 'Individual',
  applicantCompany: 'Company',

  secApplicant: '1. Applicant',
  name: 'Name',
  applicantTypeLabel: 'Applicant type',
  idTin: 'National ID / TIN',
  nationality: 'Nationality',
  address: 'Address',
  companyRegNo: 'Company registration no.',

  secLicence: '2. Licence sought',
  licenceTypeLabel: 'Licence type',
  primaryMineral: 'Primary mineral',
  otherMinerals: 'Other minerals',
  area: 'Area',
  hectares: 'hectares',
  duration: 'Duration',
  years: 'years',
  region: 'Region',
  district: 'District',
  ward: 'Ward',
  locality: 'Locality',

  secArea: '3. Licence area — boundary beacons',
  colBeacon: 'Beacon',
  colLatitude: 'Latitude',
  colLongitude: 'Longitude',

  secWork: '4. Work programme',
  proposedExpenditure: 'Proposed expenditure',
  equipment: 'Equipment',
  estimatedJobs: 'Estimated jobs',

  secFees: '5. Statutory fees',
  applicationFee: 'Application fee',
  annualRentPerHa: 'Annual rent (per hectare)',
  totalAnnualRent: 'Total annual rent',
  preparationFee: 'Preparation fee',
  totalPayable: 'Total payable on submission',

  secDeclaration: '6. Declaration',
  declarationBody:
    'I declare that the information given in this application is true and ' +
    'complete to the best of my knowledge, and I undertake to comply with ' +
    'the Mining Act, 2010, its regulations and the conditions of any licence ' +
    'granted.',
  submittedBy: 'Submitted by',
  signature: 'Signature',

  citationsTitle: 'Citations and sources',
  advisoryNote:
    'This application is prepared by Borjie for review. It is advisory and ' +
    'requires the applicant’s verification and signature before lodgement ' +
    'with the Mining Commission.',
};

const SW: LicenceApplicationLabels = {
  title: 'Maombi ya Leseni ya Madini',
  statuteLine: 'Yamewasilishwa kwa mujibu wa Sheria ya Madini, 2010',
  commissionName: 'Tume ya Madini ya Tanzania',
  reference: 'Kumbukumbu',
  date: 'Tarehe',
  licenceTypePml: 'Leseni ya Msingi ya Uchimbaji Madini (PML)',
  licenceTypePl: 'Leseni ya Utafutaji Madini (PL)',
  applicantIndividual: 'Mtu binafsi',
  applicantCompany: 'Kampuni',

  secApplicant: '1. Mwombaji',
  name: 'Jina',
  applicantTypeLabel: 'Aina ya mwombaji',
  idTin: 'Kitambulisho cha Taifa / TIN',
  nationality: 'Uraia',
  address: 'Anuani',
  companyRegNo: 'Namba ya usajili wa kampuni',

  secLicence: '2. Leseni inayoombwa',
  licenceTypeLabel: 'Aina ya leseni',
  primaryMineral: 'Madini makuu',
  otherMinerals: 'Madini mengine',
  area: 'Eneo',
  hectares: 'hekta',
  duration: 'Muda',
  years: 'miaka',
  region: 'Mkoa',
  district: 'Wilaya',
  ward: 'Kata',
  locality: 'Eneo mahususi',

  secArea: '3. Eneo la leseni — alama za mipaka',
  colBeacon: 'Alama',
  colLatitude: 'Latitudo',
  colLongitude: 'Longitudo',

  secWork: '4. Mpango wa kazi',
  proposedExpenditure: 'Matumizi yanayopendekezwa',
  equipment: 'Vifaa',
  estimatedJobs: 'Ajira zinazokadiriwa',

  secFees: '5. Ada za kisheria',
  applicationFee: 'Ada ya maombi',
  annualRentPerHa: 'Kodi ya mwaka (kwa hekta)',
  totalAnnualRent: 'Jumla ya kodi ya mwaka',
  preparationFee: 'Ada ya maandalizi',
  totalPayable: 'Jumla inayolipwa wakati wa kuwasilisha',

  secDeclaration: '6. Tamko',
  declarationBody:
    'Natamka kwamba taarifa zilizotolewa katika maombi haya ni za kweli na ' +
    'kamili kwa kadri ya ufahamu wangu, na ninaahidi kuzingatia Sheria ya ' +
    'Madini, 2010, kanuni zake na masharti ya leseni yoyote itakayotolewa.',
  submittedBy: 'Imewasilishwa na',
  signature: 'Sahihi',

  citationsTitle: 'Marejeo na vyanzo',
  advisoryNote:
    'Maombi haya yameandaliwa na Borjie kwa ajili ya mapitio. Ni ushauri na ' +
    'yanahitaji uthibitisho na sahihi ya mwombaji kabla ya kuwasilishwa kwa ' +
    'Tume ya Madini.',
};

export function pickLicenceLabels(locale: DocLocale): LicenceApplicationLabels {
  return locale === 'sw' ? SW : EN;
}
