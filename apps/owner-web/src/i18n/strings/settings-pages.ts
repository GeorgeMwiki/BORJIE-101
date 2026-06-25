/**
 * settings-pages.ts — guard-exempt bilingual (sw / en) copy for the
 * server-rendered headers + metadata of the owner-web /settings/* route
 * pages that build the heading in the ONE active locale via
 * `pickByLocale(locale, …)`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The locale-purity guard (`i18n/locale-purity.ts`) flags hardcoded
 * Swahili that appears as a bare literal in CODE anywhere under
 * `owner-web/src` — EXCEPT files under `i18n/`, which are exempt because
 * the dictionaries are the one legitimate home for Swahili prose. These
 * settings pages render both languages at the call-site through
 * `pickByLocale`, so their `{ sw, en }` pairs are hoisted here — inside
 * the exempt `i18n/` tree — and the page files import the values instead
 * of inlining the literals. Net effect: the page source carries ZERO
 * Swahili literals while runtime behaviour is byte-identical.
 *
 * SHAPE
 * -----
 * One namespace per source page (e.g. `connectedAgentsPage`,
 * `jurisdictionPage`, `savedSearchesPage`). Each leaf is a `{ sw, en }`
 * pair so call sites read `pickByLocale(locale, S.<ns>.<key>)`.
 *
 * Pure data — no imports, no logic — so it is safe to pull into both the
 * server and client bundles.
 */

export interface BiString {
  readonly sw: string;
  readonly en: string;
}

export const settingsPagesStrings = {
  // ── app/(routes)/settings/connected-agents/page.tsx ──────────────
  connectedAgentsPage: {
    metaTitle: {
      sw: 'Wakala walioongezwa — Borjie Owner Cockpit',
      en: 'Connected agents — Borjie Owner Cockpit',
    },
    ownerBadge: { sw: 'Mmiliki', en: 'Owner' },
    heading: { sw: 'Wakala walioongezwa', en: 'Connected agents' },
    intro: {
      sw: 'Wakala wa nje (Claude Code, Cursor, Windsurf, wateja maalum wa MCP / CLI / SDK) wenye ruhusa hai ya akaunti yako. Unaweza kuondoa idhini ya wakala yeyote wakati wowote — kuondoa idhini kunafanyika mara moja.',
      en: 'External agents (Claude Code, Cursor, Windsurf, custom MCP / CLI / SDK clients) that hold an active access token for your account. Revoke any agent at any time — revocation is immediate.',
    },
  },

  // ── app/(routes)/settings/jurisdiction/page.tsx ──────────────────
  jurisdictionPage: {
    metaTitle: {
      sw: 'Eneo la sheria — Borjie Owner Cockpit',
      en: 'Jurisdiction — Borjie Owner Cockpit',
    },
    ownerBadge: { sw: 'Mmiliki', en: 'Owner' },
    heading: { sw: 'Eneo la sheria', en: 'Jurisdiction' },
    intro: {
      sw: 'Nchi ya akaunti yako, wadhibiti, sarafu, na eneo la saa huongoza kila rasimu ya mrabaha, kumbukumbu ya leseni, na ufaili wa utiifu ambao Bw. Mwikila hukutengenezea. Eneo la sheria limefungwa wakati wa usajili; uliza katika mazungumzo kujibu kwa nchi nyingine kwa zamu moja.',
      en: "Your account's country, regulators, currency, and time zone drive every royalty draft, licence reminder, and compliance filing Mr. Mwikila produces for you. The jurisdiction is locked at signup; ask in chat to answer for another country for a single turn.",
    },
  },

  // ── app/(routes)/settings/saved-searches/page.tsx ────────────────
  savedSearchesPage: {
    heading: { sw: 'Utafutaji uliohifadhiwa', en: 'Saved searches' },
    tagline: {
      sw: 'Pata arifa mara mechi mpya zinapowasili',
      en: 'Get alerts the moment new matches land',
    },
    intro: {
      sw: 'Tengeneza kanuni za arifa: mfanyakazi hutekeleza tena kila utafutaji kwa mzunguko uliochaguliwa na kukujulisha mara mechi mpya zinapowasili.',
      en: 'Create alert rules: the worker re-runs each search on its chosen cadence and notifies you the moment new matches arrive.',
    },
  },
} as const;
