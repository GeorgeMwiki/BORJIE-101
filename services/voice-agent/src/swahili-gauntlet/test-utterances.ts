/**
 * 50-utterance Swahili gauntlet set covering mining-domain terminology.
 *
 * Each entry carries metadata only — actual audio fixtures live in a separate
 * object store and are loaded lazily by the runner at gauntlet-run time. The
 * fixture pointer is `audioRef` (a relative key, resolved against
 * `SWAHILI_GAUNTLET_FIXTURE_BASE` at runtime).
 *
 * Coverage breakdown:
 *   - 12  Tumemadini / NEMC / regulatory phrasing
 *   - 12  parcel-weight + drill-hole-depth dimensional language
 *   - 10  broker / bid / cooperative governance turns
 *   - 8   locality + dialect colouration (Bongo, Coast, Lake, Sheng)
 *   - 8   recording-environment stress (market, generator, low signal)
 *
 * Per immutability rule the whole module is `as const` so consumers cannot
 * mutate the set.
 */

import type { LanguageTag } from '../providers/types.js';

export type Dialect = 'bongo' | 'coast' | 'lake' | 'sheng';
export type Environment = 'quiet' | 'market' | 'generator' | 'low-signal';
export type UtteranceCategory =
  | 'regulatory'
  | 'dimensional'
  | 'governance'
  | 'dialect'
  | 'environment';

export interface SwahiliUtterance {
  readonly id: string;
  readonly category: UtteranceCategory;
  readonly dialect: Dialect;
  readonly environment: Environment;
  readonly language: LanguageTag;
  readonly referenceTranscript: string;
  /** Relative key into the fixture object store; resolved by the runner. */
  readonly audioRef: string;
  readonly notes?: string;
}

export const SWAHILI_GAUNTLET_UTTERANCES = [
  // --- Regulatory / Tumemadini / NEMC -------------------------------------
  { id: 'reg-001', category: 'regulatory', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tafadhali nipe namba ya leseni ya tumemadini', audioRef: 'reg/001.wav' },
  { id: 'reg-002', category: 'regulatory', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'parseli hii ina ruhusa ya nemc', audioRef: 'reg/002.wav' },
  { id: 'reg-003', category: 'regulatory', dialect: 'coast', environment: 'quiet', language: 'sw', referenceTranscript: 'wakaguzi wa nemc wamefika tovuti', audioRef: 'reg/003.wav' },
  { id: 'reg-004', category: 'regulatory', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'leseni yetu inakwisha tarehe ishirini machi', audioRef: 'reg/004.wav' },
  { id: 'reg-005', category: 'regulatory', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tumelipa kodi ya tozo kwa mwaka huu', audioRef: 'reg/005.wav' },
  { id: 'reg-006', category: 'regulatory', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'ripoti ya ukaguzi imeshindwa kufika', audioRef: 'reg/006.wav' },
  { id: 'reg-007', category: 'regulatory', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'wizara ya madini imetoa tangazo jipya', audioRef: 'reg/007.wav' },
  { id: 'reg-008', category: 'regulatory', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tunahitaji ruhusa ya kusafirisha parseli nje', audioRef: 'reg/008.wav' },
  { id: 'reg-009', category: 'regulatory', dialect: 'coast', environment: 'quiet', language: 'sw', referenceTranscript: 'cheti cha asili ya madini kimepatikana', audioRef: 'reg/009.wav' },
  { id: 'reg-010', category: 'regulatory', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'eneo hili linafuata kanuni za madini ndogo', audioRef: 'reg/010.wav' },
  { id: 'reg-011', category: 'regulatory', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tunaomba kibali cha kupima eneo la mradi', audioRef: 'reg/011.wav' },
  { id: 'reg-012', category: 'regulatory', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'mkaguzi anauliza kuhusu ripoti ya mazingira', audioRef: 'reg/012.wav' },

  // --- Dimensional language ----------------------------------------------
  { id: 'dim-001', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'parseli ya gramu mia tisa themanini', audioRef: 'dim/001.wav' },
  { id: 'dim-002', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'uzito wa kilo moja na gramu mia mbili', audioRef: 'dim/002.wav' },
  { id: 'dim-003', category: 'dimensional', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'kina cha mita ishirini na nne', audioRef: 'dim/003.wav' },
  { id: 'dim-004', category: 'dimensional', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'shimo limechimbwa hadi mita arobaini', audioRef: 'dim/004.wav' },
  { id: 'dim-005', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'sampuli ya gramu tano kwa kila futi', audioRef: 'dim/005.wav' },
  { id: 'dim-006', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tunafanya majaribio kwa karati mbili', audioRef: 'dim/006.wav' },
  { id: 'dim-007', category: 'dimensional', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'mwamba huo unauzito wa tani moja', audioRef: 'dim/007.wav' },
  { id: 'dim-008', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'urefu wa shaft ni mita hamsini', audioRef: 'dim/008.wav' },
  { id: 'dim-009', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'kiwango cha dhahabu ni gramu tatu kwa tani', audioRef: 'dim/009.wav' },
  { id: 'dim-010', category: 'dimensional', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'volyumu ya parseli ni mita za ujazo sita', audioRef: 'dim/010.wav' },
  { id: 'dim-011', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tunazidisha kwa mara mia kuona thamani', audioRef: 'dim/011.wav' },
  { id: 'dim-012', category: 'dimensional', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'eneo la leseni ni hekta mia mbili na hamsini', audioRef: 'dim/012.wav' },

  // --- Broker / governance ------------------------------------------------
  { id: 'gov-001', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'mnunuzi ametoa bei ya milioni kumi', audioRef: 'gov/001.wav' },
  { id: 'gov-002', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tunakubaliana kuuza kwa dola elfu nane', audioRef: 'gov/002.wav' },
  { id: 'gov-003', category: 'governance', dialect: 'coast', environment: 'quiet', language: 'sw', referenceTranscript: 'mwenyekiti wa ushirika anaomba kikao', audioRef: 'gov/003.wav' },
  { id: 'gov-004', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'wakulima wa madini wamekutana kushauriana', audioRef: 'gov/004.wav' },
  { id: 'gov-005', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'tunaomba upunguze bei kidogo tafadhali', audioRef: 'gov/005.wav' },
  { id: 'gov-006', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'mkataba wa mauzo umeshasainiwa', audioRef: 'gov/006.wav' },
  { id: 'gov-007', category: 'governance', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'asilimia kumi ni faida ya broker', audioRef: 'gov/007.wav' },
  { id: 'gov-008', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'wajumbe wamepiga kura kuunga mkono', audioRef: 'gov/008.wav' },
  { id: 'gov-009', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'malipo yatafanyika kupitia benki', audioRef: 'gov/009.wav' },
  { id: 'gov-010', category: 'governance', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'taarifa ya fedha imewasilishwa kwa wanachama', audioRef: 'gov/010.wav' },

  // --- Dialect colouration -----------------------------------------------
  { id: 'dia-001', category: 'dialect', dialect: 'sheng', environment: 'quiet', language: 'sheng', referenceTranscript: 'bro, parcel iko ready kwa pickup', audioRef: 'dia/001.wav' },
  { id: 'dia-002', category: 'dialect', dialect: 'sheng', environment: 'quiet', language: 'sheng', referenceTranscript: 'mzee, license imebooked kwa nemc', audioRef: 'dia/002.wav' },
  { id: 'dia-003', category: 'dialect', dialect: 'coast', environment: 'quiet', language: 'sw', referenceTranscript: 'mvua ikinyesha tutachelewa kufikia mgodini', audioRef: 'dia/003.wav' },
  { id: 'dia-004', category: 'dialect', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'tukutane geita siku ya tarehe nane', audioRef: 'dia/004.wav' },
  { id: 'dia-005', category: 'dialect', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'mwanza tunapata bei nzuri ya dhahabu', audioRef: 'dia/005.wav' },
  { id: 'dia-006', category: 'dialect', dialect: 'bongo', environment: 'quiet', language: 'sw', referenceTranscript: 'kariakoo soko liko shughuli sana leo', audioRef: 'dia/006.wav' },
  { id: 'dia-007', category: 'dialect', dialect: 'coast', environment: 'quiet', language: 'sw', referenceTranscript: 'tanga tunapata wateja wa madini ya chumvi', audioRef: 'dia/007.wav' },
  { id: 'dia-008', category: 'dialect', dialect: 'lake', environment: 'quiet', language: 'sw', referenceTranscript: 'mara mkoa una migodi mingi ya dhahabu', audioRef: 'dia/008.wav' },

  // --- Environment stress -------------------------------------------------
  { id: 'env-001', category: 'environment', dialect: 'bongo', environment: 'market', language: 'sw', referenceTranscript: 'parseli imepokelewa salama kabisa', audioRef: 'env/001.wav', notes: 'soko background' },
  { id: 'env-002', category: 'environment', dialect: 'bongo', environment: 'generator', language: 'sw', referenceTranscript: 'jenereta inafanya kazi tunaweza kuongea', audioRef: 'env/002.wav', notes: 'generator hum' },
  { id: 'env-003', category: 'environment', dialect: 'lake', environment: 'low-signal', language: 'sw', referenceTranscript: 'mtandao ni dhaifu sana hapa', audioRef: 'env/003.wav' },
  { id: 'env-004', category: 'environment', dialect: 'bongo', environment: 'market', language: 'sw', referenceTranscript: 'leo kuna msongamano wa watu sokoni', audioRef: 'env/004.wav' },
  { id: 'env-005', category: 'environment', dialect: 'bongo', environment: 'generator', language: 'sw', referenceTranscript: 'kelele za jenereta zinasumbua mazungumzo', audioRef: 'env/005.wav' },
  { id: 'env-006', category: 'environment', dialect: 'lake', environment: 'low-signal', language: 'sw', referenceTranscript: 'nakuomba urudie maelezo yako tena', audioRef: 'env/006.wav' },
  { id: 'env-007', category: 'environment', dialect: 'bongo', environment: 'market', language: 'sw', referenceTranscript: 'tuhamie sehemu nyingine yenye utulivu', audioRef: 'env/007.wav' },
  { id: 'env-008', category: 'environment', dialect: 'bongo', environment: 'generator', language: 'sw', referenceTranscript: 'tunakaribia mwisho wa shift ya kazi', audioRef: 'env/008.wav' },
] as const satisfies ReadonlyArray<SwahiliUtterance>;

/** Compile-time guarantee that the set is exactly 50. */
type AssertExactly50<T extends ReadonlyArray<unknown>> = T['length'] extends 50 ? true : false;
const _LENGTH_CHECK: AssertExactly50<typeof SWAHILI_GAUNTLET_UTTERANCES> = true;
void _LENGTH_CHECK;
