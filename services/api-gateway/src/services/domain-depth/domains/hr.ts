/**
 * HR — 12 sub-areas covering hire-to-retire workforce stewardship.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 4.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'headcount',
    label: { en: 'Headcount by role and site', sw: 'Idadi ya wafanyakazi kwa jukumu na tovuti' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Untracked headcount is the largest unmonitored cost in the business.',
      sw: 'Idadi ya wafanyakazi isiyofuatiliwa ni gharama kubwa zaidi isiyodhibitiwa.',
    },
    dataResolverKey: 'hr.headcount',
  },
  {
    id: 'shifts_attendance',
    label: { en: 'Shifts and attendance (biometric)', sw: 'Zamu na mahudhurio (biometriki)' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'Paper attendance is the root cause of fuel-vs-output discrepancies.',
      sw: 'Mahudhurio ya karatasi ndio chanzo cha kutofautiana kati ya mafuta na uzalishaji.',
    },
    dataResolverKey: 'hr.shifts_attendance',
  },
  {
    id: 'payroll_readiness',
    label: { en: 'Payroll readiness', sw: 'Utayari wa mishahara' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A late payroll causes pit walkouts within 48 hours.',
      sw: 'Mishahara iliyochelewa inasababisha mgomo wa shimo ndani ya saa 48.',
    },
    dataResolverKey: 'hr.payroll_readiness',
  },
  {
    id: 'statutory_contributions',
    label: { en: 'Statutory contributions (NSSF, WCF, PAYE, SDL)', sw: 'Michango ya kisheria (NSSF, WCF, PAYE, SDL)' },
    regulator: 'NSSF, WCF, TRA',
    cadence: 'monthly',
    riskIfMissed: {
      en: 'NSSF arrears compound at 5% per month under the National Social Security Fund Act 1997.',
      sw: 'Madeni ya NSSF yanaongezeka kwa 5% kwa mwezi.',
    },
    dataResolverKey: 'hr.statutory_contributions',
  },
  {
    id: 'training_cpd',
    label: { en: 'Training and CPD', sw: 'Mafunzo na maendeleo ya kitaaluma' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Lapsed safety training is a strict-liability OSHA finding.',
      sw: 'Mafunzo ya usalama yaliyokwisha ni hitimisho la dhima ya moja kwa moja la OSHA.',
    },
    dataResolverKey: 'hr.training_cpd',
  },
  {
    id: 'certifications_expiring',
    label: { en: 'Certifications expiring (blast, operator, first aid)', sw: 'Vyeti vinavyokwisha' },
    cadence: 'rolling',
    riskIfMissed: {
      en: 'A single expired blaster certificate halts the pit until reissued.',
      sw: 'Cheti kimoja cha mpulizaji kilichokwisha kinasimamisha shimo.',
    },
    dataResolverKey: 'hr.certifications_expiring',
  },
  {
    id: 'open_grievances',
    label: { en: 'Open grievances and mediation', sw: 'Malalamiko ya wazi' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Unresolved grievances escalate to the Labour Court within 60 days.',
      sw: 'Malalamiko yasiyotatuliwa yanaenda Mahakama ya Kazi ndani ya siku 60.',
    },
    dataResolverKey: 'hr.open_grievances',
  },
  {
    id: 'safety_incidents',
    label: { en: 'Safety incidents (severity, recurrence)', sw: 'Ajali za usalama' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Repeat near-misses without root-cause action become lost-time injuries.',
      sw: 'Ajali za karibu zinazorudia bila hatua ya msingi zinakuwa majeruhi.',
    },
    dataResolverKey: 'hr.safety_incidents',
  },
  {
    id: 'recruiting_pipeline',
    label: { en: 'Recruiting pipeline', sw: 'Mfumo wa kuajiri' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Slow time-to-fill forces overtime budget overruns.',
      sw: 'Muda mrefu wa kuajiri unalazimisha bajeti ya muda wa ziada.',
    },
    dataResolverKey: 'hr.recruiting_pipeline',
  },
  {
    id: 'succession_bench',
    label: { en: 'Succession bench', sw: 'Mstari wa urithi' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Key-person dependency is the largest unmonitored continuity risk.',
      sw: 'Utegemezi wa mtu mmoja ni hatari kubwa zaidi ya kuendelea.',
    },
    dataResolverKey: 'hr.succession_bench',
  },
  {
    id: 'diversity_inclusion',
    label: { en: 'Diversity and local-content workforce ratios', sw: 'Tofauti na uwiano wa yaliyomo ya ndani' },
    regulator: 'Mining Commission of Tanzania',
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Local Content Regulations 2018 tie indigenous-workforce ratios to licence renewal.',
      sw: 'Kanuni za Yaliyomo ya Ndani za 2018 zinaunganisha uwiano wa wafanyakazi wa asili na upyaji wa leseni.',
    },
    dataResolverKey: 'hr.diversity_inclusion',
  },
  {
    id: 'leavers_exit',
    label: { en: 'Leavers and exit themes', sw: 'Wanaoondoka na mada za kuondoka' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Unread exit interviews bury the real signal on management quality.',
      sw: 'Mahojiano ya kuondoka yasiyosomwa yanaficha ishara halisi.',
    },
    dataResolverKey: 'hr.leavers_exit',
  },
]);

export const HR_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'hr',
  label: { en: 'HR', sw: 'Wafanyakazi' },
  headline: {
    en: 'Full hire-to-retire workforce picture: 12 sub-areas.',
    sw: 'Picha kamili ya wafanyakazi: maeneo 12.',
  },
  subAreas: SUB_AREAS,
});
