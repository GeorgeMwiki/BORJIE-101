/**
 * Locale pass for the DETERMINISTIC fallback generator.
 *
 * The fallback skeletons (`fallbacks.ts`) are authored once in English —
 * they are the resilience path used when no brain is wired (dev / tests)
 * or every LLM proposer returns garbage. But CLAUDE.md's EN/SW absolute
 * separation applies to that path too: a Swahili owner must never see an
 * English tab. The brain GENERATES in-locale; the fallback can't call a
 * model, so it applies a deterministic phrase map instead.
 *
 * Design — GENERATIVE, not per-tab hardcode:
 *   - One phrase dictionary keyed on the canonical ENGLISH source string.
 *   - Applied UNIFORMLY across every human-visible string in the skeleton
 *     tree (tab title/description, section titles/descriptions, field
 *     labels/help/placeholder, dropdown option labels, widget titles).
 *     The same English phrase resolves to the same Swahili phrase no
 *     matter which domain skeleton it appears in — adding a domain costs
 *     nothing here.
 *   - HONEST-DEGRADE: an English phrase with no SW entry is returned
 *     unchanged. That is strictly better than crashing or fabricating —
 *     and the dictionary covers every string the shipped skeletons emit
 *     (locked by `fallback-locale.test.ts`).
 *   - System identifiers (keys, kinds, icons, option `value`s, currency
 *     codes) are NEVER touched — they are machine-stable.
 *
 * `en` is a no-op (the skeletons are already English), so the function is
 * a pure pass-through for the default locale.
 */

import type {
  PortalLocale,
  PortalTabField,
  PortalTabSection,
  PortalTabWidget,
} from '../types.js';

/**
 * Canonical English-phrase → Swahili map. Keys are the EXACT strings the
 * deterministic skeletons emit. Kept lowercase-insensitive at lookup so a
 * future skeleton tweak in casing still resolves.
 */
const SW_PHRASES: Readonly<Record<string, string>> = {
  // section / widget titles + the generic tab strings
  people: 'Wafanyakazi',
  payroll: 'Mishahara',
  'time off': 'Likizo',
  budgets: 'Bajeti',
  expenses: 'Matumizi',
  controls: 'Vidhibiti',
  evidence: 'Ushahidi',
  suppliers: 'Wasambazaji',
  'purchase orders': 'Oda za Ununuzi',
  overview: 'Muhtasari',
  headcount: 'Idadi ya wafanyakazi',
  'monthly payroll': 'Mishahara ya kila mwezi',
  'leave calendar': 'Kalenda ya likizo',
  'spend vs. budget': 'Matumizi dhidi ya bajeti',
  'control coverage': 'Ufikiaji wa vidhibiti',
  'pos by stage': 'Oda za ununuzi kwa hatua',
  'recent activity': 'Shughuli za hivi karibuni',
  // field labels
  'full name': 'Jina kamili',
  role: 'Wadhifa',
  'work email': 'Barua pepe ya kazi',
  phone: 'Simu',
  'hire date': 'Tarehe ya kuajiriwa',
  'employment type': 'Aina ya ajira',
  'pay period': 'Kipindi cha malipo',
  'gross pay': 'Mshahara ghafi',
  'net pay': 'Mshahara halisi',
  'start date': 'Tarehe ya kuanza',
  'end date': 'Tarehe ya kumaliza',
  reason: 'Sababu',
  'budget name': 'Jina la bajeti',
  period: 'Kipindi',
  envelope: 'Bahasha ya bajeti',
  vendor: 'Muuzaji',
  amount: 'Kiasi',
  date: 'Tarehe',
  receipt: 'Risiti',
  'control id': 'Kitambulisho cha kidhibiti',
  description: 'Maelezo',
  status: 'Hali',
  'last reviewed': 'Ilipitiwa mwisho',
  'linked control': 'Kidhibiti kilichounganishwa',
  file: 'Faili',
  'supplier name': 'Jina la msambazaji',
  category: 'Kundi',
  rating: 'Ukadiriaji',
  'kyc document': 'Hati ya KYC',
  'po number': 'Nambari ya oda',
  supplier: 'Msambazaji',
  'due date': 'Tarehe ya mwisho',
  name: 'Jina',
  owner: 'Mmiliki',
  // dropdown option labels + widget kpi label
  'full time': 'Muda kamili',
  'part time': 'Muda nusu',
  contractor: 'Mkandarasi',
  'annual leave': 'Likizo ya mwaka',
  'sick leave': 'Likizo ya ugonjwa',
  unpaid: 'Bila malipo',
  pass: 'Imefaulu',
  fail: 'Imeshindwa',
  'n/a': 'Haihusiki',
  'staff on payroll': 'Wafanyakazi kwenye orodha ya mishahara',
  // section description sentences (full-sentence phrases the skeletons emit)
  'roster of staff members and their key facts.':
    'Orodha ya wafanyakazi na taarifa zao muhimu.',
  'pay cycles, gross / net, payslips.':
    'Mizunguko ya malipo, ghafi / halisi, hati za malipo.',
  'leave balances, requests, approvals.':
    'Salio la likizo, maombi, na idhini.',
  'annual or quarterly budget envelopes.':
    'Bahasha za bajeti za mwaka au robo mwaka.',
  'inbound expenses, vendor invoices, receipts.':
    'Matumizi yanayoingia, ankara za wauzaji, na risiti.',
  'tracked control objectives and their owners.':
    'Malengo ya vidhibiti yanayofuatiliwa na wamiliki wao.',
  'documents + artefacts for audit.':
    'Nyaraka na ushahidi kwa ajili ya ukaguzi.',
  'approved supplier list with key facts.':
    'Orodha ya wasambazaji walioidhinishwa na taarifa muhimu.',
  'outstanding and recent pos.':
    'Oda za ununuzi zinazosubiri na za hivi karibuni.',
  'top-line facts for this area.':
    'Taarifa kuu za eneo hili.',
};

/** Translate one English phrase. Honest-degrade: unknown ⇒ unchanged. */
function tr(english: string, locale: PortalLocale): string {
  if (locale === 'en') return english;
  return SW_PHRASES[english.trim().toLowerCase()] ?? english;
}

/** Localize a generic tab title (the proposed title is often English). */
export function localizeTitle(title: string, locale: PortalLocale): string {
  return tr(title, locale);
}

/**
 * Localize the auto-generated description sentence. The English skeleton
 * uses the template `Auto-generated tab for <Title>.`; we re-author the
 * whole sentence in-locale (with the title itself localized) so no English
 * scaffolding leaks.
 */
export function localizeAutoDescription(
  title: string,
  locale: PortalLocale,
): string {
  const localizedTitle = tr(title, locale);
  if (locale === 'sw') {
    return `Tab iliyotengenezwa kiotomatiki kwa ${localizedTitle}.`;
  }
  return `Auto-generated tab for ${localizedTitle}.`;
}

function localizeField(
  field: PortalTabField,
  locale: PortalLocale,
): PortalTabField {
  return {
    ...field,
    label: tr(field.label, locale),
    ...(field.help !== undefined ? { help: tr(field.help, locale) } : {}),
    ...(field.placeholder !== undefined
      ? { placeholder: tr(field.placeholder, locale) }
      : {}),
    ...(field.options !== undefined
      ? {
          options: field.options.map((opt) => ({
            ...opt,
            label: tr(opt.label, locale),
          })),
        }
      : {}),
  };
}

function localizeWidget(
  widget: PortalTabWidget,
  locale: PortalLocale,
): PortalTabWidget {
  // The widget `config` is a free-shape render snapshot; the skeletons only
  // put a localizable `label` inside the kpi card's config, which we
  // translate when present. Everything else (series, events, columns) is
  // structural and untouched.
  const config = widget.config;
  const localizedConfig =
    config && typeof config.label === 'string'
      ? { ...config, label: tr(config.label, locale) }
      : config;
  return {
    ...widget,
    title: tr(widget.title, locale),
    ...(widget.subtitle !== undefined
      ? { subtitle: tr(widget.subtitle, locale) }
      : {}),
    config: localizedConfig,
  };
}

/**
 * Localize an entire skeleton section tree into the target locale. Pure —
 * returns a new section array, never mutates the shared skeleton constants.
 * `en` is a structural no-op (still returns a fresh array for immutability).
 */
export function localizeSkeleton(
  sections: ReadonlyArray<PortalTabSection>,
  locale: PortalLocale,
): ReadonlyArray<PortalTabSection> {
  return sections.map((section) => ({
    ...section,
    title: tr(section.title, locale),
    ...(section.description !== undefined
      ? { description: tr(section.description, locale) }
      : {}),
    fields: section.fields.map((f) => localizeField(f, locale)),
    widgets: section.widgets.map((w) => localizeWidget(w, locale)),
  }));
}
