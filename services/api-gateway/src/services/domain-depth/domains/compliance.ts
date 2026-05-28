/**
 * Compliance — 18 sub-areas, the FULL regulator-wide picture.
 *
 * Mining licences are ONE sub-area among eighteen. The MD's compliance
 * picture must cover tax, environmental, banking, trade, labour,
 * workplace safety, anti-corruption, data protection, AML, standards,
 * customs, insurance, local content, human rights, telecoms.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 1.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'mining_licences',
    label: {
      en: 'Mining licences',
      sw: 'Leseni za madini',
    },
    regulator: 'Mining Commission of Tanzania',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Operating without a current PML, ML or SML is a criminal offence under the Mining Act 2010.',
      sw: 'Kufanya kazi bila PML, ML au SML ya sasa ni kosa la jinai chini ya Sheria ya Madini ya 2010.',
    },
    dataResolverKey: 'compliance.mining_licences',
  },
  {
    id: 'tax',
    label: {
      en: 'Tax filings (royalty, CIT, PAYE, VAT, WHT)',
      sw: 'Mafaili ya kodi (mrabaha, CIT, PAYE, VAT, WHT)',
    },
    regulator: 'Tanzania Revenue Authority (TRA)',
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Royalty late triggers 5% penalty plus interest under the Mining Act 2010.',
      sw: 'Mrabaha wa kuchelewa unaleta adhabu ya 5% pamoja na riba chini ya Sheria ya Madini ya 2010.',
    },
    dataResolverKey: 'compliance.tax',
  },
  {
    id: 'environmental',
    label: {
      en: 'Environmental impact (EIA, EMP, tailings, reclamation)',
      sw: 'Athari ya mazingira (EIA, EMP, mabaki, urejesho)',
    },
    regulator: 'National Environment Management Council (NEMC)',
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Operating without a current EIA decision letter can result in site closure under the Environmental Management Act 2004.',
      sw: 'Kufanya kazi bila barua ya uamuzi wa EIA ya sasa kunaweza kusababisha kufungwa kwa tovuti chini ya Sheria ya Usimamizi wa Mazingira ya 2004.',
    },
    dataResolverKey: 'compliance.environmental',
  },
  {
    id: 'banking_fx',
    label: {
      en: 'Banking and FX (gold-window, USD repatriation, AML/CFT)',
      sw: 'Benki na FX (dirisha la dhahabu, urejeshaji wa USD, AML/CFT)',
    },
    regulator: 'Bank of Tanzania (BoT)',
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Failure to repatriate USD through the BoT gold window can suspend the export licence under the Foreign Exchange Act 1992.',
      sw: 'Kutorudisha USD kupitia dirisha la dhahabu la BoT kunaweza kusimamisha leseni ya usafirishaji chini ya Sheria ya Fedha za Kigeni ya 1992.',
    },
    dataResolverKey: 'compliance.banking_fx',
  },
  {
    id: 'trade_registration',
    label: {
      en: 'Trade registration (business name, annual returns, beneficial ownership)',
      sw: 'Usajili wa biashara (jina, marejesho ya kila mwaka, umiliki wa mwisho)',
    },
    regulator: 'Business Registrations and Licensing Agency (BRELA)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'A struck-off company cannot transact under the Companies Act 2002. Restoration is costly.',
      sw: 'Kampuni iliyofutwa haiwezi kufanya biashara chini ya Sheria ya Kampuni ya 2002.',
    },
    dataResolverKey: 'compliance.trade_registration',
  },
  {
    id: 'labour',
    label: {
      en: 'Labour (minimum wage, leave, NSSF, WCF contributions)',
      sw: 'Kazi (mshahara wa chini, likizo, NSSF, WCF)',
    },
    regulator: 'NSSF, WCF, Labour Relations Commission',
    cadence: 'monthly',
    riskIfMissed: {
      en: 'NSSF arrears compound at 5% per month under the National Social Security Fund Act 1997.',
      sw: 'Madeni ya NSSF yanaongezeka kwa 5% kwa mwezi chini ya Sheria ya NSSF ya 1997.',
    },
    dataResolverKey: 'compliance.labour',
  },
  {
    id: 'workplace_safety',
    label: {
      en: 'Workplace safety (OSHA registration, hazard registers, accident reporting)',
      sw: 'Usalama wa kazini (usajili wa OSHA, rejesta za hatari, kuripoti ajali)',
    },
    regulator: 'Occupational Safety and Health Authority (OSHA)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Operating without an OSHA workplace certificate is a strict-liability offence under the OSHA Act 2003.',
      sw: 'Kufanya kazi bila cheti cha eneo la kazi cha OSHA ni kosa la madhara chini ya Sheria ya OSHA ya 2003.',
    },
    dataResolverKey: 'compliance.workplace_safety',
  },
  {
    id: 'workforce_certifications',
    label: {
      en: 'Workforce certifications (blast, equipment, first aid)',
      sw: 'Vyeti vya wafanyakazi (milipuko, vifaa, huduma ya kwanza)',
    },
    regulator: 'NACTVET, ICA',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Uncertified blasters and operators expose the mine to fatality risk and personal liability for the MD.',
      sw: 'Wapulizaji na waendeshaji bila vyeti wanaweka mgodi katika hatari ya vifo na dhima ya kibinafsi kwa MD.',
    },
    dataResolverKey: 'compliance.workforce_certifications',
  },
  {
    id: 'anti_corruption',
    label: {
      en: 'Anti-corruption (gifts register, declarations, PCCB)',
      sw: 'Kupinga rushwa (rejesta ya zawadi, matamko, PCCB)',
    },
    regulator: 'Prevention and Combating of Corruption Bureau (PCCB)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'PCCB enforcement under the PCCA 2007 can result in personal prosecution of directors.',
      sw: 'Utekelezaji wa PCCB chini ya Sheria ya PCCA ya 2007 unaweza kusababisha mashtaka ya kibinafsi ya wakurugenzi.',
    },
    dataResolverKey: 'compliance.anti_corruption',
  },
  {
    id: 'data_protection',
    label: {
      en: 'Data protection (PDPA registration, DPIA, breach notification)',
      sw: 'Ulinzi wa data (usajili wa PDPA, DPIA, taarifa ya uvunjifu)',
    },
    regulator: 'Personal Data Protection Commission',
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'PDPA 2022 imposes fines up to 5% of annual turnover for failure to notify a breach within 72 hours.',
      sw: 'PDPA ya 2022 inaweka faini hadi 5% ya mauzo ya mwaka kwa kushindwa kutoa taarifa ya uvunjifu ndani ya saa 72.',
    },
    dataResolverKey: 'compliance.data_protection',
  },
  {
    id: 'aml_sanctions_kyc',
    label: {
      en: 'AML, sanctions and KYC',
      sw: 'AML, vikwazo na KYC',
    },
    regulator: 'Financial Intelligence Unit (FIU) under BoT',
    cadence: 'per-transaction',
    riskIfMissed: {
      en: 'A single sanctioned counterparty can trigger correspondent-bank de-risking and loss of USD clearing.',
      sw: 'Mhusika mmoja aliyepigwa vikwazo anaweza kusababisha benki kuondoa uhusiano na kupoteza upitishaji wa USD.',
    },
    dataResolverKey: 'compliance.aml_sanctions_kyc',
  },
  {
    id: 'trade_standards',
    label: {
      en: 'Trade standards (TBS, FCC, weights and measures)',
      sw: 'Viwango vya biashara (TBS, FCC, vipimo)',
    },
    regulator: 'Tanzania Bureau of Standards (TBS), Fair Competition Commission (FCC)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'TBS non-conformity can result in goods being seized at the border under the Standards Act 2009.',
      sw: 'Kutotii TBS kunaweza kusababisha bidhaa kunyakuliwa mpakani chini ya Sheria ya Viwango ya 2009.',
    },
    dataResolverKey: 'compliance.trade_standards',
  },
  {
    id: 'customs',
    label: {
      en: 'Customs (export permits, dore provenance, ASYCUDA)',
      sw: 'Forodha (vibali vya usafirishaji, asili ya dore, ASYCUDA)',
    },
    regulator: 'TRA Customs',
    cadence: 'per-shipment',
    riskIfMissed: {
      en: 'Incomplete provenance documentation can detain a dore-bar shipment for weeks under the East African Community Customs Management Act.',
      sw: 'Hati ya asili isiyokamilika inaweza kushikilia mzigo wa dore kwa wiki chini ya Sheria ya Usimamizi wa Forodha ya EAC.',
    },
    dataResolverKey: 'compliance.customs',
  },
  {
    id: 'quality_assay',
    label: {
      en: 'Quality and assay (SGS, Bureau Veritas, ICA)',
      sw: 'Ubora na uchunguzi (SGS, Bureau Veritas, ICA)',
    },
    regulator: 'SGS Tanzania, Bureau Veritas, Alex Stewart, ICA',
    cadence: 'per-parcel',
    riskIfMissed: {
      en: 'Unaccredited assay results are rejected by LBMA refiners and ICA-Brussels gem buyers.',
      sw: 'Matokeo ya uchunguzi yasiyokubalika yanakataliwa na warefiners wa LBMA na wanunuzi wa ICA-Brussels.',
    },
    dataResolverKey: 'compliance.quality_assay',
  },
  {
    id: 'insurance',
    label: {
      en: 'Insurance (workforce, plant, environmental liability)',
      sw: 'Bima (wafanyakazi, kiwanda, dhima ya mazingira)',
    },
    regulator: 'Tanzania Insurance Regulatory Authority (TIRA)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'A single uninsured tailings spill can wipe out the equity in the operating company.',
      sw: 'Umwagikaji mmoja wa mabaki bila bima unaweza kufuta usawa katika kampuni ya uendeshaji.',
    },
    dataResolverKey: 'compliance.insurance',
  },
  {
    id: 'local_content',
    label: {
      en: 'Local content (CDAs, local procurement, indigenous workforce)',
      sw: 'Yaliyomo ya ndani (CDA, ununuzi wa ndani, wafanyakazi wa asili)',
    },
    regulator: 'Mining Commission of Tanzania',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Local Content Regulations 2018 require 90% local supply by 2030; non-compliance affects licence renewal.',
      sw: 'Kanuni za Yaliyomo ya Ndani za 2018 zinahitaji ugavi wa ndani 90% ifikapo 2030.',
    },
    dataResolverKey: 'compliance.local_content',
  },
  {
    id: 'human_rights',
    label: {
      en: 'Human rights (CHRAGG, forced labour, security conduct)',
      sw: 'Haki za binadamu (CHRAGG, kazi ya kulazimishwa, mwenendo wa ulinzi)',
    },
    regulator: 'Commission for Human Rights and Good Governance (CHRAGG)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'A CHRAGG finding triggers parliamentary scrutiny and reputational fallout that takes years to recover.',
      sw: 'Hitimisho la CHRAGG linasababisha uchunguzi wa bunge na athari ya sifa inayochukua miaka kupona.',
    },
    dataResolverKey: 'compliance.human_rights',
  },
  {
    id: 'telecoms_electronic',
    label: {
      en: 'Telecoms and electronic transactions (TCRA, digital signatures)',
      sw: 'Mawasiliano na shughuli za kielektroniki (TCRA, saini za kidijitali)',
    },
    regulator: 'Tanzania Communications Regulatory Authority (TCRA)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Non-compliant e-signatures invalidate buyer contracts under the Electronic Transactions Act 2015.',
      sw: 'Saini za kielektroniki zisizotii zinabatilisha mikataba ya wanunuzi chini ya Sheria ya Shughuli za Kielektroniki ya 2015.',
    },
    dataResolverKey: 'compliance.telecoms_electronic',
  },
]);

export const COMPLIANCE_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'compliance',
  label: {
    en: 'Compliance',
    sw: 'Utii',
  },
  headline: {
    en: 'Full regulator picture: 18 sub-areas the MD must keep current.',
    sw: 'Picha kamili ya udhibiti: maeneo 18 ambayo MD lazima ayahifadhi.',
  },
  subAreas: SUB_AREAS,
});
