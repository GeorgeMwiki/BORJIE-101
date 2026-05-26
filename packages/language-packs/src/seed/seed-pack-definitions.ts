/**
 * Seed of 31 language pack definitions (UNIV-2).
 *
 * Spec: Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md (§9 — Reserved
 * slots roster).
 *
 * 2 live packs (en, sw) + 29 reserved packs. Each pack definition is
 * frozen on construction.
 *
 * BCP-47 + ISO 639 codes verified against:
 *   - RFC 5646 "Tags for Identifying Languages"
 *     https://tools.ietf.org/html/rfc5646 (accessed 2026-05-26)
 *   - ISO 639-3 Code Tables, SIL International
 *     https://iso639-3.sil.org/code_tables/639/data (accessed 2026-05-26)
 *   - ISO 639-2 Language Code List, Library of Congress
 *     https://www.loc.gov/standards/iso639-2/php/code_list.php
 *     (accessed 2026-05-26)
 *   - ISO 15924 Code Lists, Unicode Consortium
 *     https://www.unicode.org/iso15924/iso15924-codes.html
 *     (accessed 2026-05-26)
 *   - IANA Language Subtag Registry (BCP-47 source of truth)
 *     https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
 *     (accessed 2026-05-26)
 *   - CLDR Project
 *     https://cldr.unicode.org/ (accessed 2026-05-26)
 */

import type { Citation, LanguagePackDefinition } from '../types.js';

const ACCESSED = '2026-05-26';

const ISO639_3_CITATION: Citation = Object.freeze({
  url: 'https://iso639-3.sil.org/code_tables/639/data',
  title: 'ISO 639-3 Code Tables, SIL International',
  accessedAt: ACCESSED,
});

const RFC5646_CITATION: Citation = Object.freeze({
  url: 'https://tools.ietf.org/html/rfc5646',
  title: 'RFC 5646 — Tags for Identifying Languages, IETF',
  accessedAt: ACCESSED,
});

const CLDR_CITATION: Citation = Object.freeze({
  url: 'https://cldr.unicode.org/',
  title: 'Unicode CLDR Project',
  accessedAt: ACCESSED,
});

const ETHNOLOGUE_AFRICA_CITATION: Citation = Object.freeze({
  url: 'https://www.ethnologue.com/region/Africa/',
  title: 'Languages of Africa, Ethnologue (SIL International)',
  accessedAt: ACCESSED,
});

const ISO15924_CITATION: Citation = Object.freeze({
  url: 'https://www.unicode.org/iso15924/iso15924-codes.html',
  title: 'ISO 15924 Code Lists, Unicode Consortium',
  accessedAt: ACCESSED,
});

function makeDef(
  partial: Omit<LanguagePackDefinition, 'regionVariants'> & {
    readonly regionVariants?: ReadonlyArray<string>;
  },
): LanguagePackDefinition {
  return Object.freeze({
    ...partial,
    regionVariants: Object.freeze(partial.regionVariants ?? []),
  }) as LanguagePackDefinition;
}

// ---------------------------------------------------------------------------
// Live packs
// ---------------------------------------------------------------------------

const EN: LanguagePackDefinition = makeDef({
  id: 'en',
  bcp47: 'en',
  iso6391: 'en',
  iso6392: 'eng',
  iso6393: 'eng',
  nativeName: 'English',
  englishName: 'English',
  script: 'Latn',
  isRtl: false,
  status: 'live',
  regionVariants: ['en-GB', 'en-US', 'en-TZ', 'en-KE', 'en-AU'],
  macrolanguage: null,
  implementationPackage: '@borjie/language-pack-en',
  morphologyPackageId: null,
  citation: RFC5646_CITATION,
});

const SW: LanguagePackDefinition = makeDef({
  id: 'sw',
  bcp47: 'sw',
  iso6391: 'sw',
  iso6392: 'swa',
  iso6393: 'swh',
  nativeName: 'Kiswahili',
  englishName: 'Swahili',
  script: 'Latn',
  isRtl: false,
  status: 'live',
  regionVariants: ['sw-TZ', 'sw-KE'],
  // 'swa' is the macrolanguage; 'swh' is the standard-Swahili member.
  macrolanguage: 'swa',
  implementationPackage: '@borjie/language-pack-sw',
  morphologyPackageId: '@borjie/swahili-linguistics',
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

// ---------------------------------------------------------------------------
// Reserved packs (29) — grouped by script / region within blocks
// ---------------------------------------------------------------------------

// European + Latin script
const FR: LanguagePackDefinition = makeDef({
  id: 'fr',
  bcp47: 'fr',
  iso6391: 'fr',
  iso6392: 'fra',
  iso6393: 'fra',
  nativeName: 'Français',
  englishName: 'French',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const PT: LanguagePackDefinition = makeDef({
  id: 'pt',
  bcp47: 'pt',
  iso6391: 'pt',
  iso6392: 'por',
  iso6393: 'por',
  nativeName: 'Português',
  englishName: 'Portuguese',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const ES: LanguagePackDefinition = makeDef({
  id: 'es',
  bcp47: 'es',
  iso6391: 'es',
  iso6392: 'spa',
  iso6393: 'spa',
  nativeName: 'Español',
  englishName: 'Spanish',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const DE: LanguagePackDefinition = makeDef({
  id: 'de',
  bcp47: 'de',
  iso6391: 'de',
  iso6392: 'deu',
  iso6393: 'deu',
  nativeName: 'Deutsch',
  englishName: 'German',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const IT: LanguagePackDefinition = makeDef({
  id: 'it',
  bcp47: 'it',
  iso6391: 'it',
  iso6392: 'ita',
  iso6393: 'ita',
  nativeName: 'Italiano',
  englishName: 'Italian',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const NL: LanguagePackDefinition = makeDef({
  id: 'nl',
  bcp47: 'nl',
  iso6391: 'nl',
  iso6392: 'nld',
  iso6393: 'nld',
  nativeName: 'Nederlands',
  englishName: 'Dutch',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const PL: LanguagePackDefinition = makeDef({
  id: 'pl',
  bcp47: 'pl',
  iso6391: 'pl',
  iso6392: 'pol',
  iso6393: 'pol',
  nativeName: 'Polski',
  englishName: 'Polish',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

// Cyrillic
const RU: LanguagePackDefinition = makeDef({
  id: 'ru',
  bcp47: 'ru',
  iso6391: 'ru',
  iso6392: 'rus',
  iso6393: 'rus',
  nativeName: 'Русский',
  englishName: 'Russian',
  script: 'Cyrl',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ISO639_3_CITATION,
});

const UK: LanguagePackDefinition = makeDef({
  id: 'uk',
  bcp47: 'uk',
  iso6391: 'uk',
  iso6392: 'ukr',
  iso6393: 'ukr',
  nativeName: 'Українська',
  englishName: 'Ukrainian',
  script: 'Cyrl',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ISO639_3_CITATION,
});

// RTL — Arabic
const AR: LanguagePackDefinition = makeDef({
  id: 'ar',
  bcp47: 'ar',
  iso6391: 'ar',
  iso6392: 'ara',
  iso6393: 'ara',
  nativeName: 'العربية',
  englishName: 'Arabic',
  script: 'Arab',
  isRtl: true,
  status: 'reserved',
  // 'ara' is itself the macrolanguage code for Arabic varieties.
  macrolanguage: 'ara',
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ISO639_3_CITATION,
});

// CJK
const ZH_CN: LanguagePackDefinition = makeDef({
  id: 'zh-CN',
  bcp47: 'zh-CN',
  iso6391: 'zh',
  iso6392: 'zho',
  iso6393: 'cmn',
  nativeName: '中文 (简体)',
  englishName: 'Chinese (Simplified)',
  script: 'Hans',
  isRtl: false,
  status: 'reserved',
  macrolanguage: 'zho',
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ISO15924_CITATION,
});

const JA: LanguagePackDefinition = makeDef({
  id: 'ja',
  bcp47: 'ja',
  iso6391: 'ja',
  iso6392: 'jpn',
  iso6393: 'jpn',
  nativeName: '日本語',
  englishName: 'Japanese',
  // Japanese uses a mixed Han + Kana script; 'Jpan' is the ISO 15924
  // composite code (Han + Hiragana + Katakana).
  script: 'Jpan',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ISO15924_CITATION,
});

const KO: LanguagePackDefinition = makeDef({
  id: 'ko',
  bcp47: 'ko',
  iso6391: 'ko',
  iso6392: 'kor',
  iso6393: 'kor',
  nativeName: '한국어',
  englishName: 'Korean',
  script: 'Kore',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ISO15924_CITATION,
});

// Indo-Aryan / Brahmic
const HI: LanguagePackDefinition = makeDef({
  id: 'hi',
  bcp47: 'hi',
  iso6391: 'hi',
  iso6392: 'hin',
  iso6393: 'hin',
  nativeName: 'हिन्दी',
  englishName: 'Hindi',
  script: 'Deva',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ISO639_3_CITATION,
});

// SE Asian
const ID: LanguagePackDefinition = makeDef({
  id: 'id',
  bcp47: 'id',
  iso6391: 'id',
  iso6392: 'ind',
  iso6393: 'ind',
  nativeName: 'Bahasa Indonesia',
  englishName: 'Indonesian',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: 'msa',
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const TR: LanguagePackDefinition = makeDef({
  id: 'tr',
  bcp47: 'tr',
  iso6391: 'tr',
  iso6392: 'tur',
  iso6393: 'tur',
  nativeName: 'Türkçe',
  englishName: 'Turkish',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const VI: LanguagePackDefinition = makeDef({
  id: 'vi',
  bcp47: 'vi',
  iso6391: 'vi',
  iso6392: 'vie',
  iso6393: 'vie',
  nativeName: 'Tiếng Việt',
  englishName: 'Vietnamese',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

const TL: LanguagePackDefinition = makeDef({
  id: 'tl',
  bcp47: 'tl',
  iso6391: 'tl',
  iso6392: 'tgl',
  iso6393: 'tgl',
  nativeName: 'Tagalog',
  englishName: 'Tagalog (Filipino)',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: CLDR_CITATION,
});

// African languages (West + East + Southern)
const HA: LanguagePackDefinition = makeDef({
  id: 'ha',
  bcp47: 'ha',
  iso6391: 'ha',
  iso6392: 'hau',
  iso6393: 'hau',
  nativeName: 'Hausa',
  englishName: 'Hausa',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const YO: LanguagePackDefinition = makeDef({
  id: 'yo',
  bcp47: 'yo',
  iso6391: 'yo',
  iso6392: 'yor',
  iso6393: 'yor',
  nativeName: 'Yorùbá',
  englishName: 'Yoruba',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const IG: LanguagePackDefinition = makeDef({
  id: 'ig',
  bcp47: 'ig',
  iso6391: 'ig',
  iso6392: 'ibo',
  iso6393: 'ibo',
  nativeName: 'Igbo',
  englishName: 'Igbo',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const AM: LanguagePackDefinition = makeDef({
  id: 'am',
  bcp47: 'am',
  iso6391: 'am',
  iso6392: 'amh',
  iso6393: 'amh',
  nativeName: 'አማርኛ',
  englishName: 'Amharic',
  script: 'Ethi',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const SO: LanguagePackDefinition = makeDef({
  id: 'so',
  bcp47: 'so',
  iso6391: 'so',
  iso6392: 'som',
  iso6393: 'som',
  nativeName: 'Soomaali',
  englishName: 'Somali',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const OM: LanguagePackDefinition = makeDef({
  id: 'om',
  bcp47: 'om',
  iso6391: 'om',
  iso6392: 'orm',
  iso6393: 'orm',
  nativeName: 'Afaan Oromoo',
  englishName: 'Oromo',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  // 'orm' is the macrolanguage code for Oromo varieties.
  macrolanguage: 'orm',
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const RW: LanguagePackDefinition = makeDef({
  id: 'rw',
  bcp47: 'rw',
  iso6391: 'rw',
  iso6392: 'kin',
  iso6393: 'kin',
  nativeName: 'Kinyarwanda',
  englishName: 'Kinyarwanda',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const LG: LanguagePackDefinition = makeDef({
  id: 'lg',
  bcp47: 'lg',
  iso6391: 'lg',
  iso6392: 'lug',
  iso6393: 'lug',
  nativeName: 'Luganda',
  englishName: 'Luganda',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const ZU: LanguagePackDefinition = makeDef({
  id: 'zu',
  bcp47: 'zu',
  iso6391: 'zu',
  iso6392: 'zul',
  iso6393: 'zul',
  nativeName: 'isiZulu',
  englishName: 'Zulu',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const XH: LanguagePackDefinition = makeDef({
  id: 'xh',
  bcp47: 'xh',
  iso6391: 'xh',
  iso6392: 'xho',
  iso6393: 'xho',
  nativeName: 'isiXhosa',
  englishName: 'Xhosa',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

const AF: LanguagePackDefinition = makeDef({
  id: 'af',
  bcp47: 'af',
  iso6391: 'af',
  iso6392: 'afr',
  iso6393: 'afr',
  nativeName: 'Afrikaans',
  englishName: 'Afrikaans',
  script: 'Latn',
  isRtl: false,
  status: 'reserved',
  macrolanguage: null,
  implementationPackage: null,
  morphologyPackageId: null,
  citation: ETHNOLOGUE_AFRICA_CITATION,
});

// ---------------------------------------------------------------------------
// The full seed — 31 pack definitions (2 live + 29 reserved)
// ---------------------------------------------------------------------------

export const SEED_PACK_DEFINITIONS: ReadonlyArray<LanguagePackDefinition> =
  Object.freeze([
    // Live (2)
    EN,
    SW,
    // Reserved (29) — order matches the spec §9 roster
    FR,
    AR,
    PT,
    ES,
    ZH_CN,
    RU,
    HI,
    ID,
    TR,
    VI,
    DE,
    IT,
    JA,
    KO,
    PL,
    UK,
    NL,
    TL,
    HA,
    YO,
    IG,
    AM,
    SO,
    OM,
    RW,
    LG,
    ZU,
    XH,
    AF,
  ]);

if (SEED_PACK_DEFINITIONS.length !== 31) {
  throw new Error(
    `seed-pack-definitions: expected 31 packs (2 live + 29 reserved), got ${SEED_PACK_DEFINITIONS.length}`,
  );
}
