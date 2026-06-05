/**
 * Course domains — the mining-estate topic catalog for the create-course flow's
 * step 1 (domain picker).
 *
 * Ported from the BossNyumba course-domain registry and retargeted real-estate
 * -> mining: mine operations, licensing/compliance, royalties/finance, safety,
 * offtake/commercial, and investment strategy. Each domain biases the
 * deterministic concept sequencer (`conceptCategory`) toward the right slice of
 * `ESTATE_CONCEPTS` (the mining concept catalog) and gives the LLM prompt a
 * human-readable label.
 *
 * Bilingual EN/SW (single-language per render). Isomorphic — safe to import
 * through the `@borjie/ai-copilot/courses` subpath export.
 *
 * @module courses/domains
 */

import type { Concept } from '../training/concepts-catalog.js';

/** Concept categories the catalog tags each concept with. */
type ConceptCategory = Concept['category'];

export interface CourseDomain {
  readonly id: string;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly descriptionEn: string;
  readonly descriptionSw: string;
  /** Lucide icon name (rendered on the FE). */
  readonly icon: string;
  /** Concept-catalog category this domain leans on for the fallback sequencer. */
  readonly conceptCategory: ConceptCategory;
  /** Free-text seed the deterministic sequencer scores concepts against. */
  readonly topicSeed: string;
}

export const COURSE_DOMAINS: ReadonlyArray<CourseDomain> = [
  {
    id: 'mine_operations',
    labelEn: 'Mine operations',
    labelSw: 'Uendeshaji wa mgodi',
    descriptionEn:
      'Production rolls, idle-capacity loss, operator fees, and day-to-day pit running.',
    descriptionSw:
      'Uzalishaji, hasara ya uwezo usiotumika, ada za waendeshaji, na uendeshaji wa kila siku.',
    icon: 'Pickaxe',
    conceptCategory: 'operations',
    topicSeed:
      'mine operations production roll idle capacity operator fee reconciliation throughput pit',
  },
  {
    id: 'licensing_compliance',
    labelEn: 'Licensing & compliance',
    labelSw: 'Leseni na uzingatiaji',
    descriptionEn:
      'Mining Act, licence renewals, annual returns, mineral-rights register, and audit trails.',
    descriptionSw:
      'Sheria ya Madini, kuhuisha leseni, marejesho ya mwaka, daftari la haki za madini, na kumbukumbu za ukaguzi.',
    icon: 'ShieldCheck',
    conceptCategory: 'compliance',
    topicSeed:
      'licence renewal compliance mining act annual return mineral rights register audit permit PCCB',
  },
  {
    id: 'royalties_finance',
    labelEn: 'Royalties & finance',
    labelSw: 'Mrabaha na fedha',
    descriptionEn:
      'Royalty collection, arrears ladders, NOI, cap rates, and the numbers behind a mine.',
    descriptionSw:
      'Ukusanyaji wa mrabaha, ngazi za madeni, NOI, cap rate, na namba za mgodi.',
    icon: 'Wallet',
    conceptCategory: 'financial',
    topicSeed:
      'royalty finance arrears NOI cap rate DSCR reconciliation GePG offtake prepayment cost',
  },
  {
    id: 'safety_reliability',
    labelEn: 'Safety & reliability',
    labelSw: 'Usalama na uimara',
    descriptionEn:
      'Incident triage, preventive maintenance, condition monitoring, and asset reliability.',
    descriptionSw:
      'Upangaji wa dharura, matengenezo ya kuzuia, ufuatiliaji wa hali, na uimara wa vifaa.',
    icon: 'HardHat',
    conceptCategory: 'maintenance',
    topicSeed:
      'safety incident triage hazard preventive maintenance condition monitoring FMEA reliability asset',
  },
  {
    id: 'offtake_commercial',
    labelEn: 'Offtake & commercial',
    labelSw: 'Ununuzi na biashara',
    descriptionEn:
      'Offtake structures, take-or-pay, buyer qualification, and price escalation clauses.',
    descriptionSw:
      'Miundo ya ununuzi, take-or-pay, uthibitishaji wa mnunuzi, na vifungu vya kupanda kwa bei.',
    icon: 'Handshake',
    conceptCategory: 'tenancy',
    topicSeed:
      'offtake commercial take-or-pay buyer qualification escalation spot forward tolling counterparty',
  },
  {
    id: 'investment_strategy',
    labelEn: 'Investment & strategy',
    labelSw: 'Uwekezaji na mkakati',
    descriptionEn:
      'Portfolio diversification, joint ventures, hold-period analysis, and growth strategy.',
    descriptionSw:
      'Mseto wa kundi la mali, ubia, uchambuzi wa kipindi cha kushikilia, na mkakati wa ukuaji.',
    icon: 'TrendingUp',
    conceptCategory: 'strategy',
    topicSeed:
      'investment strategy portfolio diversification joint venture hold period mezzanine ROI valuation growth',
  },
];

const DOMAIN_BY_ID: ReadonlyMap<string, CourseDomain> = new Map(
  COURSE_DOMAINS.map((d) => [d.id, d]),
);

/** Resolve a domain by id, or `null` when unknown. */
export function findCourseDomain(id: string): CourseDomain | null {
  return DOMAIN_BY_ID.get(id) ?? null;
}

/** Human-readable label for a domain id in the chosen language. */
export function courseDomainLabel(id: string, language: 'en' | 'sw'): string {
  const domain = DOMAIN_BY_ID.get(id);
  if (!domain) return id;
  return language === 'sw' ? domain.labelSw : domain.labelEn;
}
