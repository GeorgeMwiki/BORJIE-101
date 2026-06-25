/**
 * Estate + LMBM surface {en, sw} string module — batch "estate-lmbm".
 *
 * Two jobs, both required by the zero-mix canon:
 *
 *   1. LOCALIZED ENUM LABEL TABLES. The estate APIs hand the cockpit raw
 *      snake_case English tokens (`asset_class`, `valuation_method`,
 *      entity `kind` / `status`, succession `status`, capital-movement
 *      `kind`). Rendering those tokens verbatim shows English text under a
 *      Swahili surface (mixing) AND leaks an implementation token to the
 *      owner. Each table maps EVERY enum member from
 *      `@borjie/database` to a `{ en, sw }` pair; `labelFor` resolves a
 *      token through the active locale and falls back to a humanized form
 *      for any value not yet in the table (never to the raw token, never
 *      to the other language).
 *
 *   2. NEW per-surface copy added in this pass — the LMBM graph error
 *      state (with retry), the time-travel "As-of" label, and the
 *      succession draft-will hand-off prompt.
 *
 * Kept in `i18n/strings` so the component/page files stay free of
 * hardcoded Swahili (the locale-purity guard's allowlist is empty).
 */

import type { Locale } from '@/lib/locale-shared';

type Pair = { readonly en: string; readonly sw: string };
type LabelTable = Readonly<Record<string, Pair>>;

/**
 * Resolve a raw enum token to its active-locale label. Unknown tokens
 * (a value added to the DB enum ahead of this table) humanize to
 * Title-Cased words — still single-language, never the raw snake_case
 * token and never a cross-language fallback.
 */
export function labelFor(
  table: LabelTable,
  token: string | null | undefined,
  locale: Locale,
): string {
  if (!token) return locale === 'sw' ? 'Haijabainishwa' : 'Unspecified';
  const hit = table[token];
  if (hit) return locale === 'sw' ? hit.sw : hit.en;
  return token
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export const estateLabels = {
  assetClass: {
    mining_licence: { en: 'Mining licence', sw: 'Leseni ya mgodi' },
    land_parcel: { en: 'Land parcel', sw: 'Kiwanja' },
    building: { en: 'Building', sw: 'Jengo' },
    plant_equipment: { en: 'Plant / equipment', sw: 'Vifaa' },
    vehicle: { en: 'Vehicle', sw: 'Gari' },
    inventory: { en: 'Inventory', sw: 'Bidhaa' },
    financial_instrument: { en: 'Financial instrument', sw: 'Chombo cha fedha' },
    intellectual_property: { en: 'IP', sw: 'Haki miliki' },
    goodwill: { en: 'Goodwill', sw: 'Sifa njema' },
    crypto: { en: 'Crypto', sw: 'Sarafu za dijiti' },
    other: { en: 'Other', sw: 'Nyingine' },
  } satisfies LabelTable,

  valuationMethod: {
    book_value: { en: 'Book value', sw: 'Thamani ya vitabu' },
    market_value: { en: 'Market value', sw: 'Thamani ya soko' },
    replacement_cost: { en: 'Replacement cost', sw: 'Gharama ya kubadilisha' },
    appraised: { en: 'Appraised', sw: 'Iliyotathminiwa' },
    discounted_cash_flow: {
      en: 'Discounted cash flow',
      sw: 'Mtiririko wa fedha uliopunguzwa',
    },
    other: { en: 'Other', sw: 'Nyingine' },
  } satisfies LabelTable,

  entityKind: {
    mine_licence_holder: { en: 'Mine licence holder', sw: 'Mwenye leseni ya mgodi' },
    processing_plant: { en: 'Processing plant', sw: 'Kiwanda cha kuchakata' },
    transport_co: { en: 'Transport company', sw: 'Kampuni ya usafirishaji' },
    equipment_rental: { en: 'Equipment rental', sw: 'Ukodishaji wa vifaa' },
    camp_catering: { en: 'Camp catering', sw: 'Huduma za chakula kambini' },
    fuel_station: { en: 'Fuel station', sw: 'Kituo cha mafuta' },
    retail_at_site: { en: 'Retail at site', sw: 'Rejareja eneoni' },
    real_estate: { en: 'Real estate', sw: 'Mali isiyohamishika' },
    agriculture: { en: 'Agriculture', sw: 'Kilimo' },
    forestry: { en: 'Forestry', sw: 'Misitu' },
    tourism: { en: 'Tourism', sw: 'Utalii' },
    security_co: { en: 'Security company', sw: 'Kampuni ya ulinzi' },
    insurance_brokerage: { en: 'Insurance brokerage', sw: 'Udalali wa bima' },
    consulting_firm: { en: 'Consulting firm', sw: 'Kampuni ya ushauri' },
    training_school: { en: 'Training school', sw: 'Shule ya mafunzo' },
    subsidiary_holding: { en: 'Subsidiary holding', sw: 'Kampuni tanzu' },
    joint_venture: { en: 'Joint venture', sw: 'Ubia' },
    other: { en: 'Other', sw: 'Nyingine' },
  } satisfies LabelTable,

  entityStatus: {
    active: { en: 'Active', sw: 'Hai' },
    dormant: { en: 'Dormant', sw: 'Tuli' },
    divested: { en: 'Divested', sw: 'Iliyouzwa' },
    wound_up: { en: 'Wound up', sw: 'Iliyofungwa' },
  } satisfies LabelTable,

  capitalMovementKind: {
    intercompany_loan: { en: 'Intercompany loan', sw: 'Mkopo wa kampuni-kati' },
    dividend: { en: 'Dividend', sw: 'Gawio' },
    capital_injection: { en: 'Capital injection', sw: 'Uwekezaji wa mtaji' },
    asset_transfer: { en: 'Asset transfer', sw: 'Uhamishaji wa mali' },
    royalty_settlement: { en: 'Royalty settlement', sw: 'Malipo ya mrabaha' },
    tax_payment: { en: 'Tax payment', sw: 'Malipo ya kodi' },
    inheritance_transfer: { en: 'Inheritance transfer', sw: 'Uhamishaji wa urithi' },
    jv_distribution: { en: 'JV distribution', sw: 'Mgawanyo wa ubia' },
  } satisfies LabelTable,

  successionStatus: {
    drafted: { en: 'Drafted', sw: 'Imeandaliwa' },
    witnessed: { en: 'Witnessed', sw: 'Imeshuhudiwa' },
    registered: { en: 'Registered', sw: 'Imesajiliwa' },
    contested: { en: 'Contested', sw: 'Imepingwa' },
    executed: { en: 'Executed', sw: 'Imetekelezwa' },
  } satisfies LabelTable,
} as const;

export const capitalMovementExtra = {
  /** Counterparty outside the estate (no from/to entity row). */
  external: { en: 'external', sw: 'nje ya miliki' },
} as const;

export const successionExtra = {
  /**
   * Seeds the Universal Doc Drafter via the live `/ask` surface so Mr.
   * Mwikila drafts the will, cites estate evidence, and lands the artefact
   * on the audit trail — there is no standalone will-builder route; will
   * drafting is a brain-cited document-drafter capability.
   */
  draftWillPrompt: (principal: string, successor: string, relation: string) => ({
    en: `Draft a will for ${principal}, naming ${successor} (${relation}) as the designated successor. Cite the estate succession plan as evidence and reference the family-office structure.`,
    sw: `Andaa wosia kwa ${principal}, ukimteua ${successor} (${relation}) kama mrithi aliyeteuliwa. Nukuu mpango wa urithi wa miliki kama ushahidi na rejea muundo wa ofisi ya familia.`,
  }),
} as const;

export const lmbmExtra = {
  asOf: { en: 'As-of', sw: 'Hadi tarehe' },
  loadErrorTitle: {
    en: 'Could not load the graph',
    sw: 'Imeshindwa kupakia grafu',
  },
  loadErrorBody: {
    en: 'The LMBM graph query failed for this as-of date. Check your connection and try again.',
    sw: 'Hoja ya grafu ya LMBM imeshindikana kwa tarehe hii. Angalia muunganisho wako na ujaribu tena.',
  },
  retry: { en: 'Try again', sw: 'Jaribu tena' },
} as const;
