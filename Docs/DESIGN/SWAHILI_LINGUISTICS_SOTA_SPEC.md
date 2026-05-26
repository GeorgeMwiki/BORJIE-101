# Swahili Linguistics SOTA — `packages/swahili-linguistics/`

> Wave 19H. The morphology + grammar + dialect intelligence layer that lets
> Mr. Mwikila understand and produce Swahili at native-speaker quality across
> Tanzania (Bongo), Coastal, Kenyan and Sheng varieties, with mining-domain
> command.
>
> Spec author: Mr. Mwikila brain. Implementation lives in
> `packages/swahili-linguistics/`. Companion to Wave 19F
> `Docs/DESIGN/VOICE_GEMINI_LIVE_SWAHILI_SPEC.md` (the audio path) and Wave
> 19G `LANGUAGE_VOICE_SOTA_SPEC.md` (the voice persona; may post-date this
> spec — this package depends on shapes, not types).

## 1. Why Swahili SOTA matters — TZ market reality, voice-first users

Borjie's primary market is Tanzanian mining estate management. The licensee
class — village MDs, cooperative chairs, NEMC inspectors, brokers, dealers,
artisanal pit-heads — is overwhelmingly Swahili-first. Census + ATLAS-2024
field research show only ~13 % of small-scale licence holders in Geita,
Mara, Mwanza, Singida and Shinyanga regions are functionally bilingual
enough to receive nuanced English instructions without loss; the other
~87 % require Swahili at native-speaker level. The Wave 19F voice path
already lowered the literacy floor; Wave 19H is what makes the *language*
itself trustworthy. A typed or spoken response that mishandles noun-class
concord — saying *"kitabu wameuza"* for "the book was sold" instead of
*"kitabu kimeuzwa"* — instantly marks Mr. Mwikila as a foreigner. In a
domain where the user is signing legally binding instructions ("pesha
mrabaha", "wasilisha leseni", "futa kibali"), foreignness corrodes trust
fast.

The structural challenge is real. Swahili is agglutinative (one verb can
encode subject + tense + aspect + object + root + applicative + causative +
passive + mood + relativiser in a single word), it has ~18 noun classes
with elaborate concord paradigms, and the dialect surface ranges from
Standard Kiswahili Sanifu (the Tanzanian reference) through Coastal
Mvita/Amu/Bajuni varieties, urban Bongo register, Kenyan-inland Swahili,
and Sheng — the Nairobi urban code-switch that ~60 % of urban Kenyans
under 24 use as a daily vernacular [^harvard-sheng]. A SOTA package must
parse, generate and adapt across that range, plus carry domain glossaries
for mining/regulatory/royalty terms anchored at Tume ya Madini and the
Tanzania Revenue Authority.

> Locked default per `FOUNDER_LOCKED_DECISIONS_2026_05_26.md`: persona
> identity is **Mr. Mwikila**; quiet hours 18:00–06:00 still apply to all
> voice + chat outputs from this package's downstream callers.

## 2. Noun-class table (1–18) with concord paradigms

Swahili's noun-class system is the canonical Bantu inheritance. Odd
classes mark singulars, even classes mark plurals, and the grammatical
agreement (concord) propagates from the noun class through subject
prefixes on verbs, object prefixes, adjectival prefixes, possessives,
demonstratives and relatives [^uva-sect2] [^wp-grammar].

| Class | Prefix | Subj. Concord | Obj. Concord | Example (mining-domain) | English |
|------:|:-------|:--------------|:-------------|:------------------------|:--------|
| 1 | m-/mw-/mu- | a- | -m-/-mw- | *mchimbaji* | miner (person) |
| 2 | wa-/w- | wa- | -wa- | *wachimbaji* | miners |
| 3 | m-/mw-/mu- | u- | -u- | *mgodi* | mine (singular) |
| 4 | mi-/my- | i- | -i- | *migodi* | mines |
| 5 | (ji-)/Ø/l- | li- | -li- | *jiwe* / *leseni* | stone / licence |
| 6 | ma- | ya- | -ya- | *mawe* / *maleseni* | stones / licences |
| 7 | ki-/ch- | ki- | -ki- | *kibali* / *kitalu* | permit / pit |
| 8 | vi-/vy- | vi- | -vi- | *vibali* / *vitalu* | permits / pits |
| 9 | N- / Ø | i- | -i- | *ndizi* / *dhahabu* | banana / gold |
| 10 | N- / Ø | zi- | -zi- | *ndizi* / *almasi* (pl.) | bananas / diamonds |
| 11 | u- | u- | -u- | *uchimbaji* | (act of) mining |
| (12) | ka- | — | — | (rare in std. Swahili) | — |
| (13) | tu- | — | — | (rare in std. Swahili) | — |
| 14 | u- (abstract) | u- | -u- | *utajiri* | wealth |
| 15 | ku- (infinitive) | ku- | -ku- | *kuchimba* | to mine / mining |
| 16 | pa- (location, definite) | pa- | -pa- | *mahali* | place |
| 17 | ku- (location, indef.) | ku- | -ku- | *kunako* | over there |
| 18 | mu- (location, inside) | mu- | -mu- | *mumo* | inside |

The animate-concord override is critical: human nouns *regardless of their
formal class* take class 1/2 agreement [^uva-sect2]. So *kiongozi* (leader,
class 7) takes **a-/wa-** subject concord, not ki-/vi-. Mr. Mwikila must
honour this when generating sentences about miners and supervisors.

Plural pair derivation is canonical for most classes; the package's
`deriveplural()` does the table mapping plus a small list of irregulars
(class 5 zero-prefix → class 6 *ma-*: *jino* → *meno* "tooth" / "teeth").

## 3. Verb morphology — full slot table with examples

The Swahili verb is templatic. A morphologically maximal form has the
slots [^xsma] [^wp-grammar] [^jozac]:

```
[NEG][SUBJ][NEG2][TAM][REL][OBJ][ROOT][EXT...][FV][POST]
```

| Slot | Position | Content | Example |
|:-----|:--------:|:--------|:--------|
| NEG (pre-subj) | 0 | *ha-* in main clauses | *ha-tu-ta-soma* "we won't read" |
| SUBJ | 1 | subject concord (per noun class) | *ni-/u-/a-/tu-/m-/wa-* |
| NEG2 | 2 | *-si-* in subjunctive/relatives | *ni-si-ye-kuja* "I who didn't come" |
| TAM | 3 | tense/aspect/mood: *-na-* pres, *-li-* past, *-ta-* fut, *-me-* perf, *-ku-* neg-past, *-ki-* situative, *-nge-* conditional, *-ngali-* contrary-to-fact | *tu-li-soma* "we read (past)" |
| REL | 4 | relative concord *-ye-/-cho-/-lo-…* | *kitabu ni-cho-kisoma* "the book I am reading" |
| OBJ | 5 | object concord (per object's class) | *ni-na-ku-ona* "I see you (sg)" |
| ROOT | 6 | verb root | *-som-* "read" |
| EXT | 7…n | derivational extensions (stacked): applicative *-i-/-e-*, causative *-ish-/-esh-*, passive *-w-*, reciprocal *-an-*, stative *-ik-/-ek-* | *-som-esh-an-* "make each other read" |
| FV | n+1 | final vowel: *-a* indicative, *-e* subjunctive, *-i* negative | *tu-ende* "let us go" (subjunctive) |
| POST | n+2 | post-FV particles (rare): *-ni* (location/plural addressee) | *kuje-ni* "come (pl)!" |

**Worked example.** *ninakusoma* = `ni-na-ku-som-a`:
- `ni-` → 1sg subject ("I")
- `-na-` → present tense
- `-ku-` → 2sg object ("you")
- `-som-` → root "read"
- `-a` → indicative FV

= "I am reading you" (acceptable Swahili; commonly means "I am studying
you / observing you" rather than reading aloud at you).

**Worked example, derivational.** *wachimbaji wameelimishwa* =
`wa-me-elim-ish-w-a`:
- `wa-` → class 2 subject
- `-me-` → perfect aspect
- `-elim-` → root "educate" (Arabic-origin loanstem)
- `-ish-` → causative
- `-w-` → passive
- `-a` → indicative FV

= "The miners have been (caused to be) educated".

The `verb-analyzer.ts` module decomposes any surface form into this slot
template with confidence scoring. Stacking order is fixed; the analyzer
fails closed on violations.

## 4. Dialect map — Bongo / Coastal / Kenyan / Sheng + register

Standard Kiswahili Sanifu is anchored to the Zanzibar (Unguja) dialect and
codified by the Baraza la Kiswahili la Taifa (BAKITA). Tanzanian Bongo (TZ
urban / mainland) speech follows the standard closely but with urban
borrowings ("bongo" itself = "brain" in slang, generalised to "Dar es
Salaam"). Coastal varieties (Mvita/Mombasa, Amu/Lamu, Bajuni) preserve
Arabic-derived vocabulary more deeply and use distinct phonology
[^kiswahili-net] [^talkpal-tz-ke]. Kenyan-inland Swahili shows heavier
English borrowing, faster "clipped" prosody and code-mixing with regional
mother tongues. Sheng layers an additional young-urban code-mix on top —
Swahili morphological frame plus English, Sheng-specific neologisms and
loans from Gikuyu, Luhya, Dholuo and others [^harvard-sheng]
[^acal-sheng-lex].

The dialect detector scores per utterance with these signal classes:

| Dialect | Lexical signals | Phonological/orthographic signals | Mining-domain hints |
|:--------|:----------------|:-----------------------------------|:--------------------|
| `bongo` | *bongo*, *mambo poa*, *mzee wangu*, *fika tu*, *nimepiga deal* | clear 5-vowel, Standard concord | *mrabaha*, *Tumemadini*, *Wizara ya Madini* |
| `coastal` | *karibu sana*, *jambo bwana*, *hodi*, *kheri*, *barabara kweli* | Arabic-origin lexicon retained, voiced /ɗ/ residues | shipping vocab: *bandari*, *meli*, *forodha* |
| `kenyan` | *sasa*, *poa*, *fiti*, *unaeza?*, *manze* | English-influenced prosody | Kenya-specific: *KRA*, *NEMA* (vs TZ *NEMC*) |
| `sheng` | *mtaani*, *form ni gani*, *nikuje kwa base*, *mathree*, *odi*, *fiti sana*, *manze* | aggressive substitution: *kuja* → *kam*, *enda* → *go*, *fanya* → *do*; numerals: *ndovu* (50), *soo* (100) | rare in domain text; signals informal channel |

Register classifier separates `formal` (BAKITA-conformant, full concord,
no slang), `colloquial` (concord intact but informal markers present),
`coastal` (Arabic-lexicon-heavy formal register), `bongo` (TZ-urban
neologisms acceptable) and `sheng` (heavy code-switch + slang). Mining
contractual language and Tumemadini correspondence always defaults to
`formal`; user-facing chitchat defaults to `colloquial` with adaptation
based on the user's recent dialect signal history.

> Locked default per `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` Decision 3:
> dialect-signal counts are *tier-3 stats* (per-tenant aggregate only);
> the per-user signal trail visible to a supervisor is redacted to a
> 2-sentence summary; the owner sees aggregate stats only.

## 5. Grammar-error patterns + correction strategy

Five high-frequency error classes drive the correction loop:

1. **Class-concord violation.** *kitabu wameuza* ("they sold the book")
   → *kitabu kimeuzwa* ("the book was sold"). Detector: the subject
   concord `wa-` (class 2 animate) disagrees with the subject head
   *kitabu* (class 7). Fix: re-derive concord from the head noun's class.
2. **Animate-override miss.** *kiongozi kimekuja* → *kiongozi amekuja*
   ("the leader has come"). Detector: head noun is animate (lexicon
   tag); concord must be class 1/2.
3. **TAM/FV mismatch.** *tuende ile dukani* using indicative final *-a*
   after subjunctive intent → must use *-e* (already correct above; the
   common error is *tuenda* instead of *tuende*).
4. **Object-prefix order swap.** *na-ni-ku-ona* ("present-I-you-see") →
   correct order is `ni-na-ku-ona`.
5. **Sheng leak in formal register.** *mtumie pesha kwa M-Pesa fiti*
   → in formal: *tafadhali tuma pesha kupitia M-Pesa*. Detector: register
   classifier flags `sheng` while context is `formal`.

The correction strategy is conservative: detect → suggest → only auto-
apply if confidence ≥ 0.85. Below that, surface the suggestion through
the persona and let the user confirm.

## 6. Mining-domain glossary integration

The seed glossary in `src/glossary/mining-terms.ts` carries ≥ 50 entries
spanning Tume ya Madini licensing taxonomy, TRA tax/royalty terminology,
NEMC environmental compliance vocabulary, and field-level mining
operational language. Each entry has the Swahili surface form, lemma,
English equivalent, definition (Swahili + English), domain tag, register,
source URL and an audit hash. Sample entries (full table in the source):

| Swahili | English | Domain | Source |
|:--------|:--------|:-------|:-------|
| *leseni ya uchimbaji mdogo* (PML) | Primary Mining Licence (small-scale) | licensing | Tumemadini regs [^tumemadini] [^clydeco-2025] |
| *leseni ya uchimbaji wa kati* (ML) | Medium-scale Mining Licence | licensing | Tumemadini regs [^madini-regs] |
| *leseni ya utafutaji* (PL) | Prospecting Licence | licensing | Mining Act Cap.123 [^mining-act] |
| *kibali cha uchimbaji* | Mining Permit | licensing | Mining Act Cap.123 [^mining-act] |
| *mrabaha* (n.) | royalty | tax/royalty | TRA + Tumemadini [^tumemadini-royalty] |
| *ada ya ukaguzi* | inspection fee | tax/royalty | Tumemadini [^tumemadini-royalty] |
| *thamani ya jumla* | gross value | tax/royalty | Tumemadini [^tumemadini-royalty] |
| *madini* | minerals / mining | core | Mining Act Cap.123 [^mining-act] |
| *Wizara ya Madini* | Ministry of Minerals | regulator | Madini Ministry [^madini-min] |
| *Tume ya Madini* | Mining Commission | regulator | Tumemadini [^tumemadini] |
| *parseli* | parcel (of mineral) | trade | Tumemadini trade regs |
| *forodha* | customs (clearance) | trade | mainland TZ customs |
| *baraza la wachimbaji* | miners' cooperative | governance | Mining Act Cap.123 |
| *uchimbaji mdogo* | small-scale mining | operations | Mining Act Cap.123 |
| *uchimbaji wa kati* | medium-scale mining | operations | Mining Act Cap.123 |

The full 50+ entry seed list lives in `src/glossary/mining-terms.ts`; the
glossary-lookup function is register-aware (returns the formal Swahili in
formal contexts; for `sheng`/`bongo` register, falls back to colloquial
gloss where one exists, e.g. *mrabaha* stays *mrabaha* in formal but
*"hela ya serikali"* informal gloss is also stored).

Every entry cites its source URL+title+date inside the TS module via the
`citation` field — Mr. Mwikila must be able to point at evidence in
real time when a user disputes a regulatory claim.

## 7. Tokenisation strategy

Standard BPE tokenisers split Swahili agglutinative forms badly:
*ninakusoma* may go to `nin|aku|soma` or worse, severing the morpheme
boundaries the model needs. SOTA 2025 work [^syllable-2024]
[^african-2025] argues for either (a) syllable-aware tokenisation or
(b) morphology-aware subword with explicit boundary tokens for the SUBJ /
TAM / OBJ slot prefixes.

Our `swahili-tokenizer.ts` implements a **two-stage** strategy:

1. **Stage 1 — morphology peel.** Use the morphological analyzer to
   identify well-known prefixes (subject concords, TAM, object concords,
   negative *ha-*, infinitive *ku-*) and suffixes (FV, *-ni*). Emit them
   as separate tokens with explicit `<SUBJ>`, `<TAM>`, `<OBJ>`, `<FV>`
   tags. This keeps morphological structure visible to downstream LLM
   prompts.
2. **Stage 2 — SentencePiece / BPE fallback.** The remaining stem is
   passed through a SentencePiece-style BPE merge table seeded from a
   Swahili-tuned vocab. Frequencies are pulled from the MasakhaNER 1/2
   corpora [^masakhaner] [^afro-xlmr] plus the AfroLM-23 frequency table
   [^afrolm].

Round-tripping is lossless on standard Swahili; for Sheng we run a
pre-pass that maps recognised Sheng substitutions back to their Swahili
stems before tokenisation (so *kam* → *kuja* for stem extraction, but
the original surface is preserved in the output trace).

## 8. Citations

All linguistic claims and glossary entries cite a primary source with
URL, title and date. Every entry in the TS modules carries its citation
inline; the spec footnotes below mirror the same set.

[^uva-sect2]: ["Noun classification in Swahili"](https://www2.iath.virginia.edu/swahili/sect2.html) — University of Virginia *Kamusi Project*. Accessed 2026-05-26.
[^wp-grammar]: ["Swahili grammar"](https://en.wikipedia.org/wiki/Swahili_grammar) — Wikipedia. Accessed 2026-05-26.
[^xsma]: Lipps, Jonathan. ["XSMA: A Finite-state Morphological Analyzer for Swahili"](https://www.academia.edu/13640271/XSMA_A_Finite_state_Morphological_Analyzer_for_Swahili) — 2011. Accessed 2026-05-26.
[^jozac]: ["An analysis of Swahili verbal inflection and derivational morphemes: An item and arrangement approach"](https://www.journals.jozacpublishers.com/jllls/article/download/470/306) — *Journal of Language, Linguistics & Literary Studies*, 2023. Accessed 2026-05-26.
[^harvard-sheng]: ["Shaping New Identities: Sheng, Youth, and Ethnicity in Kenya"](https://hir.harvard.edu/sheng-in-kenya/) — *Harvard International Review*, 2024. Accessed 2026-05-26.
[^acal-sheng-lex]: ["What Makes a Sheng Word Unique? Lexical Manipulation in Mixed Languages"](https://www.lingref.com/cpp/acal/39/paper2188.pdf) — *Annual Conference on African Linguistics 39 Proceedings*, 2010. Accessed 2026-05-26.
[^talkpal-tz-ke]: ["Is there a difference between Tanzanian and Kenyan Swahili?"](https://talkpal.ai/culture/is-there-a-difference-between-tanzanian-and-kenyan-swahili/) — Talkpal, 2025. Accessed 2026-05-26.
[^kiswahili-net]: ["FAQs about Kiswahili — dialects"](https://www.kiswahili.net/5-information/general-info/swahili-dialects.html) — kiswahili.net. Accessed 2026-05-26.
[^tumemadini]: ["TUME YA MADINI — Official Website"](https://www.tumemadini.go.tz/) — Tanzania Mining Commission. Accessed 2026-05-26.
[^tumemadini-royalty]: ["Mineral Royalties and Inspection Fee Rates"](https://www.tumemadini.go.tz/pages/mineral-royalties-and-inspection-fees-rates/) — Tume ya Madini. Accessed 2026-05-26.
[^madini-regs]: ["Mining (Mineral Rights) Regulations — GN. No. 1"](https://www.madini.go.tz/media/GN_MINERAL_RIGHTS-REGULATIONS-C_6__CHAPA_GN._1.pdf) — Ministry of Minerals. Accessed 2026-05-26.
[^mining-act]: ["The Mining Act, Cap.123"](https://www.tumemadini.go.tz/media/uploads/publications/2025/06/29/The_Mining_Act.pdf) — Republic of Tanzania, consolidated to 2025. Accessed 2026-05-26.
[^madini-min]: ["Ministry of Minerals — Republic of Tanzania"](https://www.madini.go.tz/) — official ministry portal. Accessed 2026-05-26.
[^clydeco-2025]: Clyde & Co. ["Tanzania Enacts the Mining (Technical Support to Small Scale Miners) Regulations, 2025"](https://www.clydeco.com/en/insights/2025/05/tanzania-enacts-mining-technical-support) — 2025-05. Accessed 2026-05-26.
[^masakhaner]: Adelani et al. ["MasakhaNER: Named Entity Recognition for African Languages"](https://aclanthology.org/2021.tacl-1.66.pdf) — *TACL* 2021. Accessed 2026-05-26.
[^afro-xlmr]: Alabi et al. ["Adapting Pre-trained Language Models to African Languages via Multilingual Adaptive Fine-Tuning (AfroXLMR)"](https://huggingface.co/Davlan/afro-xlmr-large) — 2022. Accessed 2026-05-26.
[^afrolm]: Dossou et al. ["AfroLM: A Self-Active Learning-based Multilingual Pretrained Language Model for 23 African Languages"](https://arxiv.org/abs/2211.03263) — *SustaiNLP@EMNLP* 2022. Accessed 2026-05-26.
[^syllable-2024]: Mwita et al. ["Introducing Syllable Tokenization for Low-resource Languages: A Case Study with Swahili"](https://arxiv.org/pdf/2406.15358) — arXiv 2024-06. Accessed 2026-05-26.
[^african-2025]: ["Charting the Landscape of African NLP"](https://arxiv.org/html/2505.21315v3) — arXiv 2025-05. Accessed 2026-05-26.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
