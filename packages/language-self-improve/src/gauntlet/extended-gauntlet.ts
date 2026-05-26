/**
 * Extended Swahili gauntlet — 200 Tanzanian-mining-domain utterance
 * prompts. Extends the Wave 19F set of 50 (which lives untouched in
 * `services/voice-agent/src/swahili-gauntlet/test-utterances.ts`) by
 * adding 150 new entries.
 *
 * Distribution (Wave 19K target — see spec §5):
 *   Regulatory  : 50  (12 from 19F + 38 new)
 *   Dimensional : 50  (12 from 19F + 38 new)
 *   Governance  : 40  (10 from 19F + 30 new)
 *   Dialect     : 30  ( 8 from 19F + 22 new)
 *   Environment : 30  ( 8 from 19F + 22 new)
 *
 * Per-dialect target (within 200):
 *   bongo : 96 (48%)
 *   lake  : 50 (25%)
 *   coast : 30 (15%)
 *   sheng : 24 (12%)
 *
 * This module ships ONLY the 150 new entries — the original 50 are
 * imported by callers from the Wave 19F module verbatim (we do not
 * duplicate or modify them). A helper `mergeWith` produces the full 200
 * set when given the Wave 19F set.
 *
 * NOTE: These are utterance *prompts* — text the model is expected to
 * produce — NOT mocks of model outputs. They function as test inputs in
 * the same way the Wave 19F set does.
 */

import type {
  Dialect,
  LanguageTag,
  UtteranceCategory,
} from '../types.js';

export interface ExtendedGauntletUtterance {
  readonly id: string;
  readonly category: UtteranceCategory;
  readonly dialect: Dialect;
  readonly language: LanguageTag;
  readonly referenceTranscript: string;
  readonly notes?: string;
}

export const EXTENDED_GAUNTLET_VERSION = '19k.1';

// ─────────────────────────────────────────────────────────────────────────
// Regulatory additions (38) → bongo 18, lake 10, coast 6, sheng 4
// ─────────────────────────────────────────────────────────────────────────
const REGULATORY_EXTRA: ReadonlyArray<ExtendedGauntletUtterance> = Object.freeze([
  { id: 'reg-x-001', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'leseni ya pml inahitaji kuhuishwa mwaka huu' },
  { id: 'reg-x-002', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'tunaomba ruhusa ya ziada ya kuchimba kwa shimo jipya' },
  { id: 'reg-x-003', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'nimepokea barua ya onyo kutoka tumemadini' },
  { id: 'reg-x-004', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'ada ya leseni imewasilishwa kupitia mfumo wa tumemadini' },
  { id: 'reg-x-005', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'wakaguzi wamepanga kufika tarehe kumi na tano' },
  { id: 'reg-x-006', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'tunahitaji nakala ya cheti cha asili ya madini kwa wateja' },
  { id: 'reg-x-007', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'aina ya leseni ni pml na ina ukomo wa miaka saba' },
  { id: 'reg-x-008', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'fomu ya sml imejazwa lakini imekosa sahihi ya mwenyekiti' },
  { id: 'reg-x-009', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'sheria mpya ya madini inazuia kuuza nje bila idhini ya tra' },
  { id: 'reg-x-010', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'asilimia ya mrabaha imepanda hadi saba kwa dhahabu' },
  { id: 'reg-x-011', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'mkaguzi ameandika ripoti ya kuomba marekebisho' },
  { id: 'reg-x-012', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'tumelipia kodi ya zuio kwa robo iliyopita' },
  { id: 'reg-x-013', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'ripoti ya nemc inahitaji ramani ya eneo la mradi' },
  { id: 'reg-x-014', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'leseni ya ml ina vipengele saba vya lazima' },
  { id: 'reg-x-015', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'kibali cha ufungaji wa mitambo kimekamilika' },
  { id: 'reg-x-016', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'tunatakiwa kuwasilisha taarifa ya uzalishaji kila mwezi' },
  { id: 'reg-x-017', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'kanuni za madini madogo zinabainisha eneo la juu hekta kumi' },
  { id: 'reg-x-018', category: 'regulatory', dialect: 'bongo', language: 'sw', referenceTranscript: 'tra wameuliza ankara ya wiki tatu zilizopita' },
  { id: 'reg-x-019', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'wakaguzi wa geita wamebainisha kasoro kadhaa' },
  { id: 'reg-x-020', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'cheti chetu cha mazingira kimeshapatikana mwanza' },
  { id: 'reg-x-021', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'ofisi ya mkoa imeagiza kufunga shimo namba tisa' },
  { id: 'reg-x-022', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'tunaomba kibali cha kusafirisha kwa njia ya isaka' },
  { id: 'reg-x-023', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'eneo la mradi ndani ya hifadhi linahitaji ruhusa maalum' },
  { id: 'reg-x-024', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'mkoa wa kagera tunafuata kanuni zilezile' },
  { id: 'reg-x-025', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'ripoti ya wakaguzi imepokelewa mwezi uliopita' },
  { id: 'reg-x-026', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'tunashauri kuongeza eneo la buffer mita arobaini' },
  { id: 'reg-x-027', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'leseni ya pl tunaomba uongezewe miezi sita' },
  { id: 'reg-x-028', category: 'regulatory', dialect: 'lake', language: 'sw', referenceTranscript: 'shughuli zote zimesimamishwa kuanzia jumatatu' },
  { id: 'reg-x-029', category: 'regulatory', dialect: 'coast', language: 'sw', referenceTranscript: 'tanga tunafuata sheria ya madini ya chumvi ya mwaka mbili elfu kumi na mbili' },
  { id: 'reg-x-030', category: 'regulatory', dialect: 'coast', language: 'sw', referenceTranscript: 'leseni yetu ya mtwara imekwisha tarehe pili' },
  { id: 'reg-x-031', category: 'regulatory', dialect: 'coast', language: 'sw', referenceTranscript: 'wakaguzi wa mtwara wameanza kazi zao asubuhi' },
  { id: 'reg-x-032', category: 'regulatory', dialect: 'coast', language: 'sw', referenceTranscript: 'kibali cha mradi wa chumvi kimekubaliwa lindi' },
  { id: 'reg-x-033', category: 'regulatory', dialect: 'coast', language: 'sw', referenceTranscript: 'ushuru wa bandari ya tanga umelipwa wiki hii' },
  { id: 'reg-x-034', category: 'regulatory', dialect: 'coast', language: 'sw', referenceTranscript: 'tunaomba muongozo wa uagizaji wa mitambo ya kuchimba' },
  { id: 'reg-x-035', category: 'regulatory', dialect: 'sheng', language: 'sheng', referenceTranscript: 'leseni iko renewed, NEMC waka-stamp jana' },
  { id: 'reg-x-036', category: 'regulatory', dialect: 'sheng', language: 'sheng', referenceTranscript: 'fomu ya tra niko nayo lakini sahihi inakosekana' },
  { id: 'reg-x-037', category: 'regulatory', dialect: 'sheng', language: 'sheng', referenceTranscript: 'parseli imecheki na inspector amesema iko sawa' },
  { id: 'reg-x-038', category: 'regulatory', dialect: 'sheng', language: 'sheng', referenceTranscript: 'royalty rate imeenda juu na tunafanya recalculation' },
]);

// ─────────────────────────────────────────────────────────────────────────
// Dimensional additions (38) → bongo 18, lake 10, coast 6, sheng 4
// ─────────────────────────────────────────────────────────────────────────
const DIMENSIONAL_EXTRA: ReadonlyArray<ExtendedGauntletUtterance> = Object.freeze([
  { id: 'dim-x-001', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'uzito wa kilogramu mbili na nusu kwa parseli ndogo' },
  { id: 'dim-x-002', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'shimo letu lina kina cha mita sitini na nane' },
  { id: 'dim-x-003', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'kiwango cha thamani ni gramu tatu nukta nne kwa tani' },
  { id: 'dim-x-004', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'volyumu ya parseli kubwa ni mita za ujazo kumi na mbili' },
  { id: 'dim-x-005', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'urefu wa kona ya shaft ni mita arobaini na tano' },
  { id: 'dim-x-006', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'eneo la mradi limepimwa hekta themanini' },
  { id: 'dim-x-007', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'unene wa mwamba ni sentimita ishirini na nne' },
  { id: 'dim-x-008', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'kipimo cha gramu mia mbili na thelathini kimethibitishwa' },
  { id: 'dim-x-009', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'sampuli mbili zina karati kumi na nane kila moja' },
  { id: 'dim-x-010', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'tani saba na nusu zimeuzwa kwa muuzaji wa kahawa' },
  { id: 'dim-x-011', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'mzigo wa kilo mia tano umewasilishwa kwa lori' },
  { id: 'dim-x-012', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'tunatumia bomba la inchi nne kwa kusafirisha' },
  { id: 'dim-x-013', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'mwendo wa kilomita sitini kwa saa ni salama' },
  { id: 'dim-x-014', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'eneo lililogeuzwa ni mita za mraba elfu mbili' },
  { id: 'dim-x-015', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'kipimo cha joto ni nyuzi joto thelathini na nne' },
  { id: 'dim-x-016', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'tani moja na gramu mia nane za malighafi' },
  { id: 'dim-x-017', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'kasoro ya gramu kumi na mbili katika sampuli ya leo' },
  { id: 'dim-x-018', category: 'dimensional', dialect: 'bongo', language: 'sw', referenceTranscript: 'urefu wa shaft umeongezeka mita kumi tangu mwezi uliopita' },
  { id: 'dim-x-019', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'mwanza tumechimba mita arobaini na sita ndani' },
  { id: 'dim-x-020', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'geita tunaomba mita kumi zaidi za drilling' },
  { id: 'dim-x-021', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'uzito wa parseli ya leo ni kilo mia nane' },
  { id: 'dim-x-022', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'kiwango cha shaba ni gramu tano kwa tani' },
  { id: 'dim-x-023', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'eneo la mradi wetu ni hekta mia tatu na hamsini' },
  { id: 'dim-x-024', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'urefu wa tunnel ni mita mia mbili' },
  { id: 'dim-x-025', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'tumeongeza mita ishirini upande wa mashariki' },
  { id: 'dim-x-026', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'sampuli zetu zote zina karati zaidi ya kumi na nne' },
  { id: 'dim-x-027', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'kipimo cha gramu tatu nukta sita kimethibitika' },
  { id: 'dim-x-028', category: 'dimensional', dialect: 'lake', language: 'sw', referenceTranscript: 'tani thelathini zimeshapitishwa kupitia ukaguzi' },
  { id: 'dim-x-029', category: 'dimensional', dialect: 'coast', language: 'sw', referenceTranscript: 'tanga tumevuna chumvi tani tisini wiki hii' },
  { id: 'dim-x-030', category: 'dimensional', dialect: 'coast', language: 'sw', referenceTranscript: 'kina cha bahari pale ni mita kumi na sita' },
  { id: 'dim-x-031', category: 'dimensional', dialect: 'coast', language: 'sw', referenceTranscript: 'eneo letu la chumvi ni hekta mia moja' },
  { id: 'dim-x-032', category: 'dimensional', dialect: 'coast', language: 'sw', referenceTranscript: 'kipimo cha joto cha bahari ni nyuzi joto ishirini na nane' },
  { id: 'dim-x-033', category: 'dimensional', dialect: 'coast', language: 'sw', referenceTranscript: 'mzigo wa kilo elfu tano umepelekwa bandari ya tanga' },
  { id: 'dim-x-034', category: 'dimensional', dialect: 'coast', language: 'sw', referenceTranscript: 'sampuli ya mtwara ina gramu mia na ishirini' },
  { id: 'dim-x-035', category: 'dimensional', dialect: 'sheng', language: 'sheng', referenceTranscript: 'parseli iko na kilos two point five exactly' },
  { id: 'dim-x-036', category: 'dimensional', dialect: 'sheng', language: 'sheng', referenceTranscript: 'shimo iko deep mita kama fifty' },
  { id: 'dim-x-037', category: 'dimensional', dialect: 'sheng', language: 'sheng', referenceTranscript: 'sample ina grade ya grams three per tonne' },
  { id: 'dim-x-038', category: 'dimensional', dialect: 'sheng', language: 'sheng', referenceTranscript: 'haul iko tani ten coming next week' },
]);

// ─────────────────────────────────────────────────────────────────────────
// Governance additions (30) → bongo 14, lake 8, coast 4, sheng 4
// ─────────────────────────────────────────────────────────────────────────
const GOVERNANCE_EXTRA: ReadonlyArray<ExtendedGauntletUtterance> = Object.freeze([
  { id: 'gov-x-001', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'mnunuzi anaomba kuongezewa muda wa kufanya malipo' },
  { id: 'gov-x-002', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'wajumbe wa ushirika tumeamua kupunguza bei kidogo' },
  { id: 'gov-x-003', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'mkataba unaeleza majukumu ya pande zote mbili' },
  { id: 'gov-x-004', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'broker amepunguza asilimia yake hadi tano' },
  { id: 'gov-x-005', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'malipo yamefanyika kwa benki ya crdb leo asubuhi' },
  { id: 'gov-x-006', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'kikao cha mwaka kitafanyika ifikapo tarehe kumi' },
  { id: 'gov-x-007', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'mwenyekiti amepokea ripoti ya katibu wa fedha' },
  { id: 'gov-x-008', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'tunashauri kuchagua mwakilishi wa wajumbe wa mkoa' },
  { id: 'gov-x-009', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'mwekezaji ametoa bei nyingine ya dola elfu kumi na mbili' },
  { id: 'gov-x-010', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'kura ya wazi imefanyika na tumekubaliana' },
  { id: 'gov-x-011', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'tunaomba bei ipande hadi shilingi milioni saba' },
  { id: 'gov-x-012', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'taarifa ya mauzo imewasilishwa kwa wanachama' },
  { id: 'gov-x-013', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'kamati ya uchunguzi imeanza kazi yake leo' },
  { id: 'gov-x-014', category: 'governance', dialect: 'bongo', language: 'sw', referenceTranscript: 'malipo yatakuja kwa awamu mbili wiki ijayo' },
  { id: 'gov-x-015', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'wakulima wa mwanza wamekutana na waziri jana' },
  { id: 'gov-x-016', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'mwakilishi wa geita ameridhia mkataba mpya' },
  { id: 'gov-x-017', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'tunaomba ushirika upitishe mabadiliko ya katiba' },
  { id: 'gov-x-018', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'kamati ya kifedha ya kagera imepokea bajeti' },
  { id: 'gov-x-019', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'wanachama wapya wamejiunga na ushirika wetu' },
  { id: 'gov-x-020', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'mnunuzi anatoka uingereza na anatumia broker wa kilimanjaro' },
  { id: 'gov-x-021', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'taarifa ya uongozi imepelekwa mkoani' },
  { id: 'gov-x-022', category: 'governance', dialect: 'lake', language: 'sw', referenceTranscript: 'mkataba mpya wa miaka mitano umesainiwa' },
  { id: 'gov-x-023', category: 'governance', dialect: 'coast', language: 'sw', referenceTranscript: 'tanga tumeunda kamati ya kufuatilia mauzo' },
  { id: 'gov-x-024', category: 'governance', dialect: 'coast', language: 'sw', referenceTranscript: 'mtwara wajumbe wamechagua mwenyekiti mpya' },
  { id: 'gov-x-025', category: 'governance', dialect: 'coast', language: 'sw', referenceTranscript: 'lindi tumepitisha bajeti ya mwaka huu' },
  { id: 'gov-x-026', category: 'governance', dialect: 'coast', language: 'sw', referenceTranscript: 'bandari ya tanga inashughulikia mzigo wetu' },
  { id: 'gov-x-027', category: 'governance', dialect: 'sheng', language: 'sheng', referenceTranscript: 'broker amefanya recount na figures zimebadilika' },
  { id: 'gov-x-028', category: 'governance', dialect: 'sheng', language: 'sheng', referenceTranscript: 'meeting imekuwa postponed hadi next week' },
  { id: 'gov-x-029', category: 'governance', dialect: 'sheng', language: 'sheng', referenceTranscript: 'deal iko closed na payment imekuwa wired' },
  { id: 'gov-x-030', category: 'governance', dialect: 'sheng', language: 'sheng', referenceTranscript: 'cooperative chairman amesema voting itakuwa tomorrow' },
]);

// ─────────────────────────────────────────────────────────────────────────
// Dialect additions (22) → bongo 6, lake 8, coast 4, sheng 4
// ─────────────────────────────────────────────────────────────────────────
const DIALECT_EXTRA: ReadonlyArray<ExtendedGauntletUtterance> = Object.freeze([
  { id: 'dia-x-001', category: 'dialect', dialect: 'bongo', language: 'sw', referenceTranscript: 'dar es salaam tunafuata muda wa biashara wa saa nne' },
  { id: 'dia-x-002', category: 'dialect', dialect: 'bongo', language: 'sw', referenceTranscript: 'kariakoo soko la madini lipo barabara ya msimbazi' },
  { id: 'dia-x-003', category: 'dialect', dialect: 'bongo', language: 'sw', referenceTranscript: 'kinondoni mteja anasubiri kwa makini' },
  { id: 'dia-x-004', category: 'dialect', dialect: 'bongo', language: 'sw', referenceTranscript: 'ilala tumesimika ofisi mpya ya broker' },
  { id: 'dia-x-005', category: 'dialect', dialect: 'bongo', language: 'sw', referenceTranscript: 'temeke kuna gharama kubwa za mali' },
  { id: 'dia-x-006', category: 'dialect', dialect: 'bongo', language: 'sw', referenceTranscript: 'ubungo kuna msafara wa madini kila wiki' },
  { id: 'dia-x-007', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'sengerema kuna wachimbaji wengi wadogo' },
  { id: 'dia-x-008', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'shinyanga tunafanya biashara na watu wa nyamongo' },
  { id: 'dia-x-009', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'kahama tunazo migodi midogo mingi' },
  { id: 'dia-x-010', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'tabora tunakwenda kupitia kilimanjaro' },
  { id: 'dia-x-011', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'biharamulo tuna leseni mpya za pl' },
  { id: 'dia-x-012', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'misungwi tumegundua mwamba mzuri' },
  { id: 'dia-x-013', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'magu tuna shida ya umeme wakati wa mvua' },
  { id: 'dia-x-014', category: 'dialect', dialect: 'lake', language: 'sw', referenceTranscript: 'rorya tunapata wateja wa kenya' },
  { id: 'dia-x-015', category: 'dialect', dialect: 'coast', language: 'sw', referenceTranscript: 'mafia tunavuna chumvi muda wote' },
  { id: 'dia-x-016', category: 'dialect', dialect: 'coast', language: 'sw', referenceTranscript: 'pemba kuna wateja wengi wa karafu' },
  { id: 'dia-x-017', category: 'dialect', dialect: 'coast', language: 'sw', referenceTranscript: 'unguja eneo letu lipo umoja wa sokoine' },
  { id: 'dia-x-018', category: 'dialect', dialect: 'coast', language: 'sw', referenceTranscript: 'kilwa tumechimba mwamba wa thamani' },
  { id: 'dia-x-019', category: 'dialect', dialect: 'sheng', language: 'sheng', referenceTranscript: 'msee, parcel iko deli mafiks kwa lock-up' },
  { id: 'dia-x-020', category: 'dialect', dialect: 'sheng', language: 'sheng', referenceTranscript: 'cheki, sample ya gold iko safi sana mzito' },
  { id: 'dia-x-021', category: 'dialect', dialect: 'sheng', language: 'sheng', referenceTranscript: 'budah, broker amesema fika kwa office kesho' },
  { id: 'dia-x-022', category: 'dialect', dialect: 'sheng', language: 'sheng', referenceTranscript: 'fam, kibarua kimekuwa solved by upgrade ya mitambo' },
]);

// ─────────────────────────────────────────────────────────────────────────
// Environment additions (22) → bongo 12, lake 6, coast 2, sheng 2
// ─────────────────────────────────────────────────────────────────────────
const ENVIRONMENT_EXTRA: ReadonlyArray<ExtendedGauntletUtterance> = Object.freeze([
  { id: 'env-x-001', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'mvua kubwa imezuia usafiri kwa lori leo', notes: 'rain' },
  { id: 'env-x-002', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'jenereta limeharibika tunarekebisha sasa', notes: 'generator outage' },
  { id: 'env-x-003', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'kelele za mashine zinapunguza usikivu wa simu', notes: 'machinery noise' },
  { id: 'env-x-004', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'mawasiliano hayako vizuri kwa sababu ya upepo mkali', notes: 'wind' },
  { id: 'env-x-005', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'msongamano wa magari unachelewesha mzigo wetu', notes: 'traffic' },
  { id: 'env-x-006', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'jua kali linapunguza ufanisi wa wafanyakazi mchana', notes: 'heat' },
  { id: 'env-x-007', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'umeme umekatika tena na tunatumia jenereta', notes: 'power cut' },
  { id: 'env-x-008', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'mtandao wa simu uko polepole sana hapa', notes: 'low signal' },
  { id: 'env-x-009', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'vumbi linafanya mawasiliano kuwa magumu sana', notes: 'dust' },
  { id: 'env-x-010', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'sauti ya mafundi inazidi sauti ya simu yangu', notes: 'workers chatter' },
  { id: 'env-x-011', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'kelele za genge la sokoni ziko juu sana', notes: 'market' },
  { id: 'env-x-012', category: 'environment', dialect: 'bongo', language: 'sw', referenceTranscript: 'piki piki nyingi zinapita karibu nasi', notes: 'motorbike' },
  { id: 'env-x-013', category: 'environment', dialect: 'lake', language: 'sw', referenceTranscript: 'mwanza tunaomba kuiongelea baada ya mvua', notes: 'rain' },
  { id: 'env-x-014', category: 'environment', dialect: 'lake', language: 'sw', referenceTranscript: 'geita umeme uko shaka tangu jana usiku', notes: 'power flux' },
  { id: 'env-x-015', category: 'environment', dialect: 'lake', language: 'sw', referenceTranscript: 'kahama mtandao uko down kwa muda mfupi', notes: 'network' },
  { id: 'env-x-016', category: 'environment', dialect: 'lake', language: 'sw', referenceTranscript: 'shinyanga jua ni kali sana mchana huu', notes: 'heat' },
  { id: 'env-x-017', category: 'environment', dialect: 'lake', language: 'sw', referenceTranscript: 'mara kuna upepo mwingi karibu na ziwa', notes: 'wind' },
  { id: 'env-x-018', category: 'environment', dialect: 'lake', language: 'sw', referenceTranscript: 'biharamulo kuna kelele za mashua zinatusumbua', notes: 'boat noise' },
  { id: 'env-x-019', category: 'environment', dialect: 'coast', language: 'sw', referenceTranscript: 'tanga upepo wa bahari ni mkali sana asubuhi', notes: 'sea wind' },
  { id: 'env-x-020', category: 'environment', dialect: 'coast', language: 'sw', referenceTranscript: 'pwani ya unguja kuna kelele za boti', notes: 'boat' },
  { id: 'env-x-021', category: 'environment', dialect: 'sheng', language: 'sheng', referenceTranscript: 'network iko down, ngoja niwaite na another phone', notes: 'connectivity' },
  { id: 'env-x-022', category: 'environment', dialect: 'sheng', language: 'sheng', referenceTranscript: 'generator iko buzzing kelele iko juu', notes: 'generator hum' },
]);

export const EXTENDED_GAUNTLET_UTTERANCES: ReadonlyArray<ExtendedGauntletUtterance> =
  Object.freeze([
    ...REGULATORY_EXTRA,
    ...DIMENSIONAL_EXTRA,
    ...GOVERNANCE_EXTRA,
    ...DIALECT_EXTRA,
    ...ENVIRONMENT_EXTRA,
  ]);

/** Runtime guarantee that the new additions count is exactly 150.
 *  Throws at module load time if the file ever drifts. */
if (EXTENDED_GAUNTLET_UTTERANCES.length !== 150) {
  throw new Error(
    `EXTENDED_GAUNTLET_UTTERANCES expected exactly 150 entries; got ${EXTENDED_GAUNTLET_UTTERANCES.length}`,
  );
}

/**
 * Compute per-category and per-dialect tallies for the extended set —
 * surfaces both the additions and the merged set when given the Wave 19F
 * baseline.
 */
export interface GauntletTally {
  readonly perCategory: Readonly<Record<UtteranceCategory, number>>;
  readonly perDialect: Readonly<Record<Dialect, number>>;
  readonly total: number;
}

export function tallyGauntlet(
  utterances: ReadonlyArray<{ category: UtteranceCategory; dialect: Dialect }>,
): GauntletTally {
  const perCategory: Record<UtteranceCategory, number> = {
    regulatory: 0,
    dimensional: 0,
    governance: 0,
    dialect: 0,
    environment: 0,
  };
  const perDialect: Record<Dialect, number> = {
    bongo: 0,
    coast: 0,
    lake: 0,
    sheng: 0,
    other: 0,
  };
  for (const u of utterances) {
    perCategory[u.category] = (perCategory[u.category] ?? 0) + 1;
    perDialect[u.dialect] = (perDialect[u.dialect] ?? 0) + 1;
  }
  return Object.freeze({
    perCategory: Object.freeze(perCategory),
    perDialect: Object.freeze(perDialect),
    total: utterances.length,
  });
}
