/**
 * Risk — 14 sub-areas covering enterprise risk: financial, operational,
 * regulatory, reputational, environmental, geopolitical, market, cyber.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 6.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'operational_risk',
    label: { en: 'Operational risk', sw: 'Hatari ya uendeshaji' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Untracked equipment failure probability leaves the pit one breakdown from idle.',
      sw: 'Uwezekano wa hitilafu ya vifaa usiofuatiliwa unaacha shimo karibu na kusimama.',
    },
    dataResolverKey: 'risk.operational',
  },
  {
    id: 'financial_risk',
    label: { en: 'Financial risk (default, FX, liquidity, debt-service)', sw: 'Hatari ya kifedha' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'A single buyer default can wipe out a month of EBITDA.',
      sw: 'Kushindwa kwa mnunuzi mmoja kunaweza kufuta EBITDA ya mwezi.',
    },
    dataResolverKey: 'risk.financial',
  },
  {
    id: 'regulatory_risk',
    label: { en: 'Regulatory risk (Mining Act amendments, BoT circulars, TRA notices)', sw: 'Hatari ya udhibiti' },
    cadence: 'rolling',
    riskIfMissed: {
      en: 'An unread BoT circular changes royalty rates without notice.',
      sw: 'Mzunguko wa BoT usiosomwa unabadilisha viwango bila taarifa.',
    },
    dataResolverKey: 'risk.regulatory',
  },
  {
    id: 'compliance_risk',
    label: { en: 'Compliance risk (open findings, enforcement actions)', sw: 'Hatari ya utii' },
    cadence: 'rolling',
    riskIfMissed: {
      en: 'Open audit findings compound into regulator enforcement within a year.',
      sw: 'Hitimisho la ukaguzi linakua na kuwa utekelezaji ndani ya mwaka.',
    },
    dataResolverKey: 'risk.compliance',
  },
  {
    id: 'reputational_risk',
    label: { en: 'Reputational risk (press, social, NGO campaigns)', sw: 'Hatari ya sifa' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'A single viral NGO video can shut a site for a week.',
      sw: 'Video moja ya NGO inaweza kufunga tovuti kwa wiki.',
    },
    dataResolverKey: 'risk.reputational',
  },
  {
    id: 'environmental_risk',
    label: { en: 'Environmental risk (tailings, spill, climate)', sw: 'Hatari ya mazingira' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A tailings dam failure is the largest catastrophic risk in mining.',
      sw: 'Kushindwa kwa bwawa la mabaki ni hatari kubwa zaidi.',
    },
    dataResolverKey: 'risk.environmental',
  },
  {
    id: 'geopolitical_risk',
    label: { en: 'Geopolitical risk (Tanzania stability, smuggling, sanctions)', sw: 'Hatari ya kisiasa' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Cross-border smuggling pressure displaces local sales without warning.',
      sw: 'Magendo ya mpakani yanaondoa mauzo ya ndani bila onyo.',
    },
    dataResolverKey: 'risk.geopolitical',
  },
  {
    id: 'commodity_price_risk',
    label: { en: 'Commodity-price risk (LBMA gold, gem, copper)', sw: 'Hatari ya bei ya bidhaa' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'An unhedged 5% LBMA drop wipes a typical month of margin.',
      sw: 'Kushuka kwa LBMA 5% bila ulinzi kunafuta faida ya mwezi.',
    },
    dataResolverKey: 'risk.commodity_price',
  },
  {
    id: 'currency_risk',
    label: { en: 'Currency risk (TZS, USD, KES exposure)', sw: 'Hatari ya sarafu' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'TZS/USD daily swings of 2.4% turn into TZS millions of unforced loss.',
      sw: 'Mabadiliko ya TZS/USD kwa siku ni hasara ya TZS milioni.',
    },
    dataResolverKey: 'risk.currency',
  },
  {
    id: 'counterparty_risk',
    label: { en: 'Counterparty risk (buyer, off-taker, refiner credit)', sw: 'Hatari ya mhusika' },
    cadence: 'per-transaction',
    riskIfMissed: {
      en: 'Unscreened counterparties can pull correspondent-bank de-risking.',
      sw: 'Wahusika wasiochunguzwa wanaweza kuondoa uhusiano wa benki.',
    },
    dataResolverKey: 'risk.counterparty',
  },
  {
    id: 'cyber_risk',
    label: { en: 'Cyber risk (phishing, ransomware, BoT cyber-resilience)', sw: 'Hatari ya mtandao' },
    regulator: 'BoT cyber-resilience framework',
    cadence: 'rolling',
    riskIfMissed: {
      en: 'A ransomware attack can halt payroll and royalty filing simultaneously.',
      sw: 'Shambulio la ransomware linaweza kusimamisha mishahara na mrabaha kwa pamoja.',
    },
    dataResolverKey: 'risk.cyber',
  },
  {
    id: 'insurance_gap',
    label: { en: 'Insurance gap (coverage vs identified risks)', sw: 'Pengo la bima' },
    regulator: 'Tanzania Insurance Regulatory Authority (TIRA)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'An uninsured environmental spill can wipe out the equity in the operating company.',
      sw: 'Umwagikaji bila bima unaweza kufuta usawa.',
    },
    dataResolverKey: 'risk.insurance_gap',
  },
  {
    id: 'geological_risk',
    label: { en: 'Geological risk (reserve depletion, grade decline, hydrology)', sw: 'Hatari ya kijiolojia' },
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Reserve depletion without replacement quietly shortens mine life.',
      sw: 'Kupungua kwa hifadhi bila kubadili kunafupisha maisha ya mgodi.',
    },
    dataResolverKey: 'risk.geological',
  },
  {
    id: 'human_capital_risk',
    label: { en: 'Human-capital risk (key-person, union, skill shortage)', sw: 'Hatari ya rasilimali watu' },
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Key-person dependency is the largest unmonitored continuity risk.',
      sw: 'Utegemezi wa mtu mmoja ni hatari kubwa zaidi.',
    },
    dataResolverKey: 'risk.human_capital',
  },
]);

export const RISK_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'risk',
  label: { en: 'Risk', sw: 'Hatari' },
  headline: {
    en: 'Full enterprise risk: 14 sub-areas across financial, operational, regulatory, reputational.',
    sw: 'Hatari kamili ya biashara: maeneo 14.',
  },
  subAreas: SUB_AREAS,
});
