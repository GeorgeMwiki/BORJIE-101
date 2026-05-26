# Universal Language Packs — Registry, Schema, and Pluggable Pack Recipe

> UNIV-2 deliverable. Companion to
> `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`
> (the locked invariant: Borjie is built for the entire world; Tanzania
> is the launch beachhead, not the architectural boundary).
>
> Spec author: Mr. Mwikila brain. Implementation lives under
> `packages/language-packs/`, `packages/language-pack-en/`, and
> `packages/language-pack-sw/`. Persistence lives in migration
> `0056_universal_language_packs.sql` + schema file
> `packages/database/src/schemas/universal-language-packs.schema.ts`.
> Sibling specs (structurally compatible, not import-coupled):
> `LANGUAGE_VOICE_SOTA_SPEC.md` (Wave 19G),
> `SWAHILI_LINGUISTICS_SOTA_SPEC.md` (Wave 19H),
> `TRANSLATION_SOTA_SPEC.md` (Wave 19I).

## 1. Vision — language is a pack, not a branch

Every language we ship is a **package**, every package is a **pack**,
and every pack is **uniform in shape**. Mr. Mwikila reasons in a single
universal cognitive core; the linguistic surface (orthography, dialect
signals, voice profile, locale resources, domain glossaries) lives in
a pluggable pack layer. Adding a new language to Borjie is not a
refactor — it is a single new package `@borjie/language-pack-{code}`
that registers itself with the registry, plus optionally one new row
in `language_pack_definitions` flipping its `status` from `reserved`
to `live`. No core code changes. No spec rewrites. No migration churn.

The contrast is sharp. Most LLM-platform stacks (and most multilingual
product stacks generally) hardcode anglocentric defaults and bolt
other languages on through a `translations.json` file. The result is
brittle: the second-class languages get their adjectival concord
wrong, their currency formatted in the wrong direction, their dates
in the wrong order, their voice provider mapped to the wrong dialect.
Borjie inverts that. Every language gets the same first-class pack
shape from day one, even if the first 28 of them are reserved slots
with no implementation behind them yet.

This document defines (a) the pack shape every implementation must
honour, (b) the registry table and its lookup semantics, (c) the
mapping between BCP-47 / ISO 639-1 / ISO 639-2 / ISO 639-3 / CLDR
locale identifiers, (d) the 5-step recipe for adding a new pack, and
(e) the 30 reserved-slot roster the launch ships with.

## 2. The pack shape

Every `@borjie/language-pack-{code}` package exports the same five
surfaces:

1. **Locale resources** — date/number/currency/collation formats per
   BCP-47 region variant. Sourced from CLDR — the Unicode Common
   Locale Data Repository — which is the canonical reference for
   locale data and supplies the rules for languages, scripts and
   regions ([CLDR project page, Unicode Consortium, accessed
   2026-05-26][cldr-home]). Number and date formatting follow the
   conventions ICU adopts from CLDR ([ICU Locales and Resources docs,
   Unicode Consortium, accessed 2026-05-26][icu-locale]).
2. **Voice profile defaults** — preferred TTS provider, voice id and
   prosody profile per region. For Swahili the launch defaults are
   **Lelapa Vulavula** primary (per Wave 19G finding — the only
   African-owned TTS stack with first-class Swahili coverage),
   **ElevenLabs v3** Swahili fallback, **Google Cloud Chirp 3** as a
   third-tier general-purpose backstop. Gemini Live is **NOT** used
   for Swahili because it does not currently support the language
   ([Gemini API supported languages, Google AI, accessed
   2026-05-26][gemini-langs]). When (and only when) Gemini Live ships
   Swahili support, the matrix can be re-evaluated through a Wave 19F
   spec amendment, not a code patch.
3. **Domain glossaries** — bilingual mining-domain (and future
   agri/oil-gas/etc.) term tables. Every entry cites a primary source
   URL + title + access date.
4. **Dialect signals (optional)** — for languages with significant
   regional or sociolinguistic variation (Swahili has Bongo / Coastal /
   Kenyan / Sheng / Standard), the pack exports lexicon-based dialect
   markers downstream callers can use to route register-appropriate
   responses.
5. **Pack definition** — one row registered in `language_pack_definitions`
   carrying the BCP-47 tag, the ISO 639 codes, native + English
   display names, RTL flag, script identifier, status, and reserved-
   for-implementation pointer.

The registry-side artefact is the pack **definition**; the package-
side artefact is the pack **implementation**. Reserved packs have a
definition only (their `status = 'reserved'`). Live packs have both.

## 3. BCP-47 + ISO 639 mapping

Every pack carries four parallel identifiers so callers can resolve
the pack from whatever standard the upstream caller uses:

- **`id`** — the canonical pack id. Equals the BCP-47 primary subtag
  for monolingual packs (`en`, `sw`, `fr`, `ar`) and the full BCP-47
  tag for region-locked packs (`sw-TZ`, `sw-KE`, `zh-CN`). This is
  the database primary key.
- **`bcp47`** — the IETF BCP-47 language tag per RFC 5646 ([RFC 5646
  "Tags for Identifying Languages", IETF, accessed
  2026-05-26][rfc5646]). RFC 5646 plus RFC 4647 together comprise
  BCP-47 ([IETF language tag, Wikipedia, accessed
  2026-05-26][wp-bcp47]). Tags are hyphen-separated subtags; region
  subtags distinguish varieties like en-GB vs en-US ([BCP 47 language
  tag, MDN, accessed 2026-05-26][mdn-bcp47]).
- **`iso_639_1`** — the two-letter ISO 639-1 code (e.g. `en`, `sw`,
  `ar`). ISO 639-1 covers ~180 languages and is maintained by Infoterm
  ([ISO 639 Code Tables, SIL International, accessed
  2026-05-26][iso639-3]).
- **`iso_639_2`** — the three-letter ISO 639-2 bibliographic code
  (e.g. `eng`, `swa`, `ara`). ISO 639-2 is maintained by the Library
  of Congress ([Library of Congress ISO 639-2 list, accessed
  2026-05-26][loc-639-2]).
- **`iso_639_3`** — the three-letter ISO 639-3 code covering all
  individual languages (living, extinct, ancient), maintained by SIL
  International ([ISO 639-3 home, SIL International, accessed
  2026-05-26][iso639-3]).

In code, the resolution is one lookup: `registry.findById(id)` or
`registry.findByBcp47(tag)`. Both return the same
`LanguagePackDefinition`.

## 4. Locale resources (CLDR-derived)

Every live pack ships the per-region locale resource block:

- **`dateFormat`** — short / medium / long / full patterns. Example:
  `en-US` = `MM/dd/yyyy`; `en-GB` = `dd/MM/yyyy`; `sw-TZ` =
  `dd/MM/yyyy`; `de-DE` = `dd.MM.yyyy`. Patterns follow the LDML
  date-format pattern syntax ([Unicode LDML report TR-35,
  accessed 2026-05-26][ldml-tr35]).
- **`numberFormat`** — decimal + group separator, decimal-digit
  count, percent symbol position. Example: `en-US` = `.` decimal, `,`
  group; `de-DE` = `,` decimal, `.` group; `fr-FR` = `,` decimal,
  ` ` (NBSP) group; `sw-TZ` follows the en-GB pattern.
- **`currency`** — the ISO 4217 code + the locale-default format.
  Example: `en-US` = `USD` formatted `$1,234.56`; `en-GB` = `GBP`
  formatted `£1,234.56`; `sw-TZ` = `TZS` formatted `TSh 1,234.56`;
  `sw-KE` = `KES` formatted `KSh 1,234.56`.
- **`collation`** — the CLDR / ICU collation rule key. Most Latin-
  script languages use the default ICU collation; Swahili uses the
  default + an animacy-concord override; Arabic uses the
  `compat` collation; Chinese uses `pinyin` or `stroke` per locale
  ([ICU collation, Unicode Consortium, accessed
  2026-05-26][icu-collation]).
- **`firstDayOfWeek`** — locale convention. Most jurisdictions
  start the week on Monday; US starts on Sunday.
- **`weekendDays`** — array of weekday indices. Most jurisdictions
  use `[6, 0]` (Saturday + Sunday); MENA jurisdictions often use
  `[5, 6]` (Friday + Saturday).

Locale resources are derived from CLDR canonical data. The current
CLDR release is v45 with v49 in active submission cycle (CLDR Survey
Tool opened for General Submission on 2026-04-29 per the Unicode
project page) ([Unicode CLDR Project, accessed 2026-05-26][cldr-home]).

## 5. Voice profile defaults

Every live pack carries a default voice profile per region variant:

- **Provider primary / fallback / tertiary.** Same 3-tier shape as
  the Wave 19F voice spec.
- **Voice id per provider.** A stable identifier per region (e.g.
  `en-US-Standard-J` on Polly, `Charlotte` on ElevenLabs).
- **Prosody profile.** Default pitch / rate / energy parameters
  tuned per region. The launch defaults are conservative; per-tenant
  overrides ride on the Wave 19F user-prosody-profile table.

The Swahili pack defaults are: **Lelapa Vulavula** primary
(`@lelapa/vulavula-swahili`), **ElevenLabs v3 Swahili** fallback,
**Google Cloud Chirp 3** third-tier general-purpose backstop. Gemini
Live is explicitly excluded for Swahili because it does not currently
support Swahili. Per Wave 19G these are pinned for both `sw-TZ` and
`sw-KE` with prosody contour deltas captured at the dialect-signal
layer. The English pack defaults to **ElevenLabs v3** primary,
**Google Cloud Chirp 3** fallback, **AWS Polly Neural** tertiary
across en-GB / en-US / en-TZ / en-KE / en-AU variants.

## 6. Domain glossary slots

Every live pack reserves slots for domain glossaries. The launch
ships **mining** for both English and Swahili. Future verticals
(agri, oil-gas, fisheries, forestry, manufacturing, tourism, real
estate) plug additional glossary slots onto the same pack.

A glossary entry shape is:

```
{
  term: string;           // source-language surface form
  lemma: string;          // uninflected root
  enEquivalent: string;   // canonical English translation
  domain: string;         // 'licensing' | 'tax' | 'royalty' | ...
  register: string;       // 'formal' | 'colloquial' | regional slang
  citation: {
    url: string;
    title: string;
    accessedAt: string;   // ISO date
  };
}
```

Every entry MUST carry a citation URL + title + access date. The
Swahili mining glossary cites Tume ya Madini, Ministry of Minerals,
the Mining Act Cap.123 (2025 consolidation), the Mineral Royalties
and Inspection Fee Rates publication, and the Tanzania Revenue
Authority. The English mining glossary cites the same source plus
international references where translations are not direct.

## 7. Per-pack required surface

Every live pack package exports:

- `src/locale.ts` — locale resource block per supported region variant.
- `src/voice.ts` — voice profile defaults per region variant.
- `src/glossary-mining.ts` — mining-domain glossary entries.
- `src/dialect.ts` *(optional)* — dialect signal markers if the
  language has significant register variation.
- `src/index.ts` — public barrel re-exporting the above.

Reserved packs ship only the pack-definition row in the registry;
no package directory is created. When the implementation lands, the
new package's barrel exports a single `register()` function the
registry calls at boot to flip the `status` from `reserved` to
`live`.

## 8. How to add a new language pack (5-step recipe)

1. **Add the pack definition row.** Append a new entry to
   `packages/language-packs/src/seed/seed-pack-definitions.ts` with
   the BCP-47 tag, ISO codes, native + English display names, RTL
   flag, script identifier, and `status: 'reserved'`.
2. **Create the implementation package.** `mkdir
   packages/language-pack-{code}/src` and copy the en pack as a
   template. Replace the per-region locale block with the new
   language's CLDR-derived data.
3. **Implement voice defaults.** Wire the 3-tier provider matrix
   for the language. If only one provider exists (e.g. Polly does
   not yet support the language), set the lower tiers to null and
   the registry flags the pack as voice-degraded.
4. **Author the mining glossary.** At least 50 entries; every entry
   cites a primary source URL + title + access date.
5. **Flip the status flag.** Update the seed row from `'reserved'`
   to `'live'`. CI runs the registry-test suite which verifies the
   new pack's exports satisfy the pack shape contract. PR review
   checks the citations are real.

That is the entire workflow. No core code change, no migration, no
spec rewrite.

## 9. Reserved slots roster

The launch ships 31 pack definitions:

- **Live (2):** `en` (English), `sw` (Swahili — with TZ + KE region
  variants).
- **Reserved (29):** `fr` (French), `ar` (Arabic, RTL), `pt`
  (Portuguese), `es` (Spanish), `zh-CN` (Chinese Simplified), `ru`
  (Russian, Cyrillic), `hi` (Hindi, Devanagari), `id` (Indonesian),
  `tr` (Turkish), `vi` (Vietnamese), `de` (German), `it` (Italian),
  `ja` (Japanese, Han + Kana), `ko` (Korean, Hangul), `pl` (Polish),
  `uk` (Ukrainian, Cyrillic), `nl` (Dutch), `tl` (Tagalog/Filipino),
  `ha` (Hausa), `yo` (Yoruba), `ig` (Igbo), `am` (Amharic, Ge'ez),
  `so` (Somali), `om` (Oromo), `rw` (Kinyarwanda), `lg` (Luganda),
  `zu` (Zulu), `xh` (Xhosa), `af` (Afrikaans).

The African languages cluster (Hausa, Yoruba, Igbo, Amharic, Oromo,
Somali, Kinyarwanda, Luganda, Zulu, Xhosa, Afrikaans) reflects the
"most spoken African languages" cross-reference: Swahili leads at
~200M speakers, Hausa at ~100M, Yoruba at ~45M, Amharic at ~57M
(speaker counts vary slightly by source) ([Top 15 Most Spoken
Languages in Africa, Tuko 2026, accessed 2026-05-26][tuko-africa];
[The Most Spoken Languages in Africa, PoliLingua, accessed
2026-05-26][polilingua-africa]).

The non-Latin script cluster (`ar`, `zh-CN`, `ru`, `hi`, `ja`, `ko`,
`uk`, `am`) plus RTL languages (`ar`) signal the script-handling
infrastructure the cognitive engine must respect even at launch —
input sanitisation, font selection, bidirectional text rendering
([Right-to-left languages, Smartling Help Center, accessed
2026-05-26][smartling-rtl]; bidi handling follows the Unicode
Bidirectional Algorithm TR-9 ([Unicode TR-9, accessed
2026-05-26][unicode-bidi])). The African-language cluster reflects
Ethnologue's continental survey of speaker counts and language
families ([Languages of Africa, Ethnologue, accessed
2026-05-26][ethnologue-africa]).

The Asian + European cluster (`fr`, `pt`, `es`, `de`, `it`, `nl`,
`pl`, `id`, `tr`, `vi`, `ja`, `ko`, `tl`) covers the major non-
African expansion markets per the addendum invariant.

## 10. TZ + KE Swahili register differences

The Swahili pack ships region variants for `sw-TZ` and `sw-KE` because
the two varieties differ enough to matter for Mr. Mwikila's voice
register. Tanzanian Swahili is closest to the Zanzibari standard
(Kiswahili Sanifu); Kenyan Swahili "evolves rapidly, especially in
cities", and Nairobi's youth code-switch register Sheng mixes Swahili
with English and Kikuyu ([Talkpal Tanzania vs Kenya Swahili,
accessed 2026-05-26][talkpal-tz-ke]; [Sheng in Kenya, Harvard
International Review, accessed 2026-05-26][hir-sheng]). Tanzanian
Swahili uses kinship terms (dada, mzee, kaka, mjomba) as honorifics
more heavily; Kenyan Swahili is more direct.

The `sw-TZ` voice profile defaults to the formal/Bongo register; the
`sw-KE` profile defaults to the standard/Kenyan register with the
dialect detector elevating Sheng signals when present. The mining
glossary is shared across both region variants because Tanzanian
Tume ya Madini terminology is the cross-border canonical reference.

## 11. Telemetry + logging

Every pack constructor accepts an injected `createLogger(TelemetryConfig)`
matching the `@borjie/observability` shape (mirrored locally per pack
to avoid bundle bloat — same pattern as `translation-sota/logger.ts`).
Logs redact the standard sensitive field set (`password`, `token`,
`secret`, `apiKey`, `authorization`, `creditCard`, `ssn`, `bankAccount`).
The pack-level logger emits `info` on registry boot, `warn` when a
caller requests a reserved-status pack, `error` on pack-shape
contract violations (e.g. missing required locale resource block).

## 12. Live-test discipline

Per the Borjie live-test discipline, every test in the pack-test
suite hits real data structures. The registry tests load the actual
30-entry seed; the en-pack tests resolve actual `Intl.DateTimeFormat`
behaviour across en-GB / en-US / en-TZ / en-KE / en-AU; the sw-pack
tests verify dialect classification on canonical reference utterances.
No mocks. No stubs. No skipped specs.

## 13. Provenance — citations

[rfc5646]: https://tools.ietf.org/html/rfc5646 "RFC 5646 — Tags for Identifying Languages, IETF, accessed 2026-05-26"
[wp-bcp47]: https://en.wikipedia.org/wiki/IETF_language_tag "IETF language tag, Wikipedia, accessed 2026-05-26"
[mdn-bcp47]: https://developer.mozilla.org/en-US/docs/Glossary/BCP_47_language_tag "BCP 47 language tag, MDN Web Docs, accessed 2026-05-26"
[iso639-3]: https://iso639-3.sil.org/code_tables/639/data "ISO 639 Code Tables, SIL International, accessed 2026-05-26"
[loc-639-2]: https://www.loc.gov/standards/iso639-2/php/code_list.php "ISO 639-2 Language Code List, Library of Congress, accessed 2026-05-26"
[cldr-home]: https://cldr.unicode.org/ "Unicode CLDR Project, Unicode Consortium, accessed 2026-05-26"
[icu-locale]: https://unicode-org.github.io/icu/userguide/locale/ "Locales and Resources, ICU Documentation, accessed 2026-05-26"
[icu-collation]: https://icu.unicode.org/ "ICU — International Components for Unicode, Unicode Consortium, accessed 2026-05-26"
[ldml-tr35]: https://www.unicode.org/reports/tr35/ "Unicode Locale Data Markup Language (LDML) — TR-35, accessed 2026-05-26"
[tuko-africa]: https://www.tuko.co.ke/341859-15-spoken-languages-africa-2026.html "Top 15 most spoken languages in Africa in 2026, Tuko, accessed 2026-05-26"
[polilingua-africa]: https://www.polilingua.com/blog/post/major-african-languages-overview.htm "The Most Spoken Languages in Africa, PoliLingua, accessed 2026-05-26"
[smartling-rtl]: https://help.smartling.com/hc/en-us/articles/1260802028830-Right-to-left-RTL-Languages "Right-to-left (RTL) Languages, Smartling, accessed 2026-05-26"
[talkpal-tz-ke]: https://talkpal.ai/culture/is-there-a-difference-between-tanzanian-and-kenyan-swahili/ "Is there a difference between Tanzanian and Kenyan Swahili?, Talkpal, accessed 2026-05-26"
[hir-sheng]: https://hir.harvard.edu/sheng-in-kenya/ "Shaping New Identities: Sheng, Youth, and Ethnicity in Kenya, Harvard International Review, accessed 2026-05-26"
[gemini-langs]: https://ai.google.dev/gemini-api/docs/models/gemini#available-languages "Gemini API — supported languages, Google AI for Developers, accessed 2026-05-26"
[lelapa-vulavula]: https://lelapa.ai/ "Lelapa AI — Vulavula speech & language models for African languages, accessed 2026-05-26"
[ethnologue-africa]: https://www.ethnologue.com/region/Africa/ "Languages of Africa, Ethnologue (SIL International), accessed 2026-05-26"
[unicode-bidi]: https://www.unicode.org/reports/tr9/ "Unicode Bidirectional Algorithm (TR-9), Unicode Consortium, accessed 2026-05-26"

## 14. Out of scope

- **Translation between packs.** Lives in `@borjie/translation-sota`
  (Wave 19I); not duplicated here.
- **Morphology + syntax.** Lives in `@borjie/swahili-linguistics`
  (Wave 19H) and the language-specific morphology packages that
  will follow for Arabic, Hindi, etc. The pack-definition row carries
  a `morphology_package_id` pointer (nullable for languages without
  morphology support).
- **Voice path itself.** Lives in `@borjie/voice-swahili` (Wave 19F)
  and the upcoming language-voice SOTA package. The pack's voice
  profile is a *handle*, not an implementation.
- **Jurisdiction-profile lookup.** Lives in
  `@borjie/jurisdiction-profile-tz` (and future siblings). The pack
  carries no jurisdiction-specific data; that mapping happens at
  the tenant-config layer.

The pack layer is intentionally **thin**. Its job is to be the same
shape for every language, no exceptions.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
