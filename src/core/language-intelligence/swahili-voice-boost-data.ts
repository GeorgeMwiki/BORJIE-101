/**
 * Swahili Voice Boost -- Static Data
 *
 * Contains pronunciation guides, financial phrases, number words,
 * and ASR error corrections. Separated from the main module to
 * keep both files under the 400-line guideline.
 *
 * @module swahili-voice-boost-data
 */

import type { PronunciationGuide } from "./swahili-voice-boost";

// ============================================================================
// Common Agglutinative Financial Verbs (top 50)
// ============================================================================

/**
 * 50 common agglutinative Swahili financial verbs with morpheme boundaries.
 * These are the forms borrowers actually speak during loan applications.
 */
export const AGGLUTINATIVE_FINANCIAL_VERBS: readonly PronunciationGuide[] = [
  {
    word: "ninataka",
    phonetic: "ni-na-TA-ka",
    stressPattern: "ni-na-TA-ka",
    morphemeBoundaries: "ni-na-tak-a",
  },
  {
    word: "ninahitaji",
    phonetic: "ni-na-hi-TA-ji",
    stressPattern: "ni-na-hi-TA-ji",
    morphemeBoundaries: "ni-na-hitaj-i",
  },
  {
    word: "ninalipa",
    phonetic: "ni-na-LI-pa",
    stressPattern: "ni-na-LI-pa",
    morphemeBoundaries: "ni-na-lip-a",
  },
  {
    word: "nitaomba",
    phonetic: "ni-ta-OM-ba",
    stressPattern: "ni-ta-OM-ba",
    morphemeBoundaries: "ni-ta-omb-a",
  },
  {
    word: "nimekopa",
    phonetic: "ni-me-KO-pa",
    stressPattern: "ni-me-KO-pa",
    morphemeBoundaries: "ni-me-kop-a",
  },
  {
    word: "tunataka",
    phonetic: "tu-na-TA-ka",
    stressPattern: "tu-na-TA-ka",
    morphemeBoundaries: "tu-na-tak-a",
  },
  {
    word: "tunahitaji",
    phonetic: "tu-na-hi-TA-ji",
    stressPattern: "tu-na-hi-TA-ji",
    morphemeBoundaries: "tu-na-hitaj-i",
  },
  {
    word: "tunalipa",
    phonetic: "tu-na-LI-pa",
    stressPattern: "tu-na-LI-pa",
    morphemeBoundaries: "tu-na-lip-a",
  },
  {
    word: "tutaomba",
    phonetic: "tu-ta-OM-ba",
    stressPattern: "tu-ta-OM-ba",
    morphemeBoundaries: "tu-ta-omb-a",
  },
  {
    word: "tumekopa",
    phonetic: "tu-me-KO-pa",
    stressPattern: "tu-me-KO-pa",
    morphemeBoundaries: "tu-me-kop-a",
  },
  {
    word: "analipa",
    phonetic: "a-na-LI-pa",
    stressPattern: "a-na-LI-pa",
    morphemeBoundaries: "a-na-lip-a",
  },
  {
    word: "atakopa",
    phonetic: "a-ta-KO-pa",
    stressPattern: "a-ta-KO-pa",
    morphemeBoundaries: "a-ta-kop-a",
  },
  {
    word: "amekopa",
    phonetic: "a-me-KO-pa",
    stressPattern: "a-me-KO-pa",
    morphemeBoundaries: "a-me-kop-a",
  },
  {
    word: "anahitaji",
    phonetic: "a-na-hi-TA-ji",
    stressPattern: "a-na-hi-TA-ji",
    morphemeBoundaries: "a-na-hitaj-i",
  },
  {
    word: "wanalipa",
    phonetic: "wa-na-LI-pa",
    stressPattern: "wa-na-LI-pa",
    morphemeBoundaries: "wa-na-lip-a",
  },
  {
    word: "tumemaliza",
    phonetic: "tu-me-ma-LI-za",
    stressPattern: "tu-me-ma-LI-za",
    morphemeBoundaries: "tu-me-maliz-a",
  },
  {
    word: "nimewekeza",
    phonetic: "ni-me-we-KE-za",
    stressPattern: "ni-me-we-KE-za",
    morphemeBoundaries: "ni-me-wekez-a",
  },
  {
    word: "ninahesabu",
    phonetic: "ni-na-he-SA-bu",
    stressPattern: "ni-na-he-SA-bu",
    morphemeBoundaries: "ni-na-hesabu",
  },
  {
    word: "tutawekeza",
    phonetic: "tu-ta-we-KE-za",
    stressPattern: "tu-ta-we-KE-za",
    morphemeBoundaries: "tu-ta-wekez-a",
  },
  {
    word: "nimerejesha",
    phonetic: "ni-me-re-JE-sha",
    stressPattern: "ni-me-re-JE-sha",
    morphemeBoundaries: "ni-me-rejesh-a",
  },
  {
    word: "unalipa",
    phonetic: "u-na-LI-pa",
    stressPattern: "u-na-LI-pa",
    morphemeBoundaries: "u-na-lip-a",
  },
  {
    word: "unataka",
    phonetic: "u-na-TA-ka",
    stressPattern: "u-na-TA-ka",
    morphemeBoundaries: "u-na-tak-a",
  },
  {
    word: "unahitaji",
    phonetic: "u-na-hi-TA-ji",
    stressPattern: "u-na-hi-TA-ji",
    morphemeBoundaries: "u-na-hitaj-i",
  },
  {
    word: "utaomba",
    phonetic: "u-ta-OM-ba",
    stressPattern: "u-ta-OM-ba",
    morphemeBoundaries: "u-ta-omb-a",
  },
  {
    word: "umekopa",
    phonetic: "u-me-KO-pa",
    stressPattern: "u-me-KO-pa",
    morphemeBoundaries: "u-me-kop-a",
  },
  {
    word: "hatukopeshwa",
    phonetic: "ha-tu-ko-PE-shwa",
    stressPattern: "ha-tu-ko-PE-shwa",
    morphemeBoundaries: "ha-tu-kopesh-w-a",
  },
  {
    word: "nilipokopa",
    phonetic: "ni-li-po-KO-pa",
    stressPattern: "ni-li-po-KO-pa",
    morphemeBoundaries: "ni-li-po-kop-a",
  },
  {
    word: "walipokwenda",
    phonetic: "wa-li-po-KWEN-da",
    stressPattern: "wa-li-po-KWEN-da",
    morphemeBoundaries: "wa-li-po-kwend-a",
  },
  {
    word: "hatutakwenda",
    phonetic: "ha-tu-ta-KWEN-da",
    stressPattern: "ha-tu-ta-KWEN-da",
    morphemeBoundaries: "ha-tu-ta-kwend-a",
  },
  {
    word: "ameomba",
    phonetic: "a-me-OM-ba",
    stressPattern: "a-me-OM-ba",
    morphemeBoundaries: "a-me-omb-a",
  },
  {
    word: "walihesabu",
    phonetic: "wa-li-he-SA-bu",
    stressPattern: "wa-li-he-SA-bu",
    morphemeBoundaries: "wa-li-hesabu",
  },
  {
    word: "tutadhamini",
    phonetic: "tu-ta-dha-MI-ni",
    stressPattern: "tu-ta-dha-MI-ni",
    morphemeBoundaries: "tu-ta-dhamin-i",
  },
  {
    word: "nimeidhinisha",
    phonetic: "ni-me-i-dhi-NI-sha",
    stressPattern: "ni-me-i-dhi-NI-sha",
    morphemeBoundaries: "ni-me-idhinish-a",
  },
  {
    word: "wameidhinisha",
    phonetic: "wa-me-i-dhi-NI-sha",
    stressPattern: "wa-me-i-dhi-NI-sha",
    morphemeBoundaries: "wa-me-idhinish-a",
  },
  {
    word: "alithamini",
    phonetic: "a-li-tha-MI-ni",
    stressPattern: "a-li-tha-MI-ni",
    morphemeBoundaries: "a-li-thamin-i",
  },
  {
    word: "nitathamini",
    phonetic: "ni-ta-tha-MI-ni",
    stressPattern: "ni-ta-tha-MI-ni",
    morphemeBoundaries: "ni-ta-thamin-i",
  },
  {
    word: "wamechangisha",
    phonetic: "wa-me-chan-GI-sha",
    stressPattern: "wa-me-chan-GI-sha",
    morphemeBoundaries: "wa-me-changish-a",
  },
  {
    word: "tulihifadhi",
    phonetic: "tu-li-hi-FA-dhi",
    stressPattern: "tu-li-hi-FA-dhi",
    morphemeBoundaries: "tu-li-hifadh-i",
  },
  {
    word: "nitaokota",
    phonetic: "ni-ta-o-KO-ta",
    stressPattern: "ni-ta-o-KO-ta",
    morphemeBoundaries: "ni-ta-okot-a",
  },
  {
    word: "amekadiriwa",
    phonetic: "a-me-ka-DI-ri-wa",
    stressPattern: "a-me-ka-DI-ri-wa",
    morphemeBoundaries: "a-me-kadiir-w-a",
  },
  {
    word: "watabiashara",
    phonetic: "wa-ta-bi-a-SHA-ra",
    stressPattern: "wa-ta-bi-a-SHA-ra",
    morphemeBoundaries: "wa-ta-biashar-a",
  },
  {
    word: "nimesimamisha",
    phonetic: "ni-me-si-ma-MI-sha",
    stressPattern: "ni-me-si-ma-MI-sha",
    morphemeBoundaries: "ni-me-simamish-a",
  },
  {
    word: "tutahamisho",
    phonetic: "tu-ta-ha-MI-sho",
    stressPattern: "tu-ta-ha-MI-sho",
    morphemeBoundaries: "tu-ta-hamish-o",
  },
  {
    word: "nimepunguza",
    phonetic: "ni-me-pu-NGU-za",
    stressPattern: "ni-me-pu-NGU-za",
    morphemeBoundaries: "ni-me-punguz-a",
  },
  {
    word: "ameongeza",
    phonetic: "a-me-o-NGE-za",
    stressPattern: "a-me-o-NGE-za",
    morphemeBoundaries: "a-me-ongez-a",
  },
  {
    word: "tutafaidika",
    phonetic: "tu-ta-fa-I-di-ka",
    stressPattern: "tu-ta-fa-I-di-ka",
    morphemeBoundaries: "tu-ta-faidik-a",
  },
  {
    word: "nimetathmini",
    phonetic: "ni-me-tath-MI-ni",
    stressPattern: "ni-me-tath-MI-ni",
    morphemeBoundaries: "ni-me-tathmin-i",
  },
  {
    word: "walitangaza",
    phonetic: "wa-li-ta-NGA-za",
    stressPattern: "wa-li-ta-NGA-za",
    morphemeBoundaries: "wa-li-tangaz-a",
  },
  {
    word: "nimelipwa",
    phonetic: "ni-me-LI-pwa",
    stressPattern: "ni-me-LI-pwa",
    morphemeBoundaries: "ni-me-lip-w-a",
  },
  {
    word: "tutakopeshana",
    phonetic: "tu-ta-ko-pe-SHA-na",
    stressPattern: "tu-ta-ko-pe-SHA-na",
    morphemeBoundaries: "tu-ta-kopesh-an-a",
  },
];

// ============================================================================
// Common Financial Phrases
// ============================================================================

export const FINANCIAL_PHRASES: readonly string[] = [
  "kiwango cha riba",
  "fomu ya maombi",
  "mkopo wa biashara",
  "akaunti ya akiba",
  "akaunti ya benki",
  "hati ya kumiliki",
  "hati miliki",
  "mpango wa malipo",
  "kiasi cha mkopo",
  "muda wa mkopo",
  "dhamana ya mkopo",
  "thamani ya mali",
  "taarifa ya mapato",
  "leseni ya biashara",
  "usajili wa biashara",
  "ushuru wa mapato",
  "kodi ya ongezeko la thamani",
  "mkopo wa nyumba",
  "bima ya mkopo",
  "mdhamini wa mkopo",
  "kiwango cha faida",
  "risiti ya malipo",
  "ankara ya malipo",
  "bajeti ya biashara",
  "mtaji wa kuanzia",
  "mkopo wa kilimo",
  "riba ya mwaka",
  "jumla ya deni",
  "salio la akaunti",
  "uhamisho wa pesa",
  "kupata mkopo",
  "kulipa mkopo",
  "kufungua akaunti",
  "thamani ya rehani",
  "ushahidi wa mapato",
];

// ============================================================================
// Number Words
// ============================================================================

/**
 * Swahili spoken number words mapped to their numeric values.
 * Used by the ASR normalizer to convert "milioni tano" to "5,000,000".
 */
export const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ["moja", 1],
  ["mbili", 2],
  ["tatu", 3],
  ["nne", 4],
  ["tano", 5],
  ["sita", 6],
  ["saba", 7],
  ["nane", 8],
  ["tisa", 9],
  ["kumi", 10],
  ["ishirini", 20],
  ["thelathini", 30],
  ["arobaini", 40],
  ["hamsini", 50],
  ["sitini", 60],
  ["sabini", 70],
  ["themanini", 80],
  ["tisini", 90],
  ["mia", 100],
  ["elfu", 1000],
  ["laki", 100_000],
  ["milioni", 1_000_000],
  ["bilioni", 1_000_000_000],
]);

// ============================================================================
// ASR Error Corrections
// ============================================================================

/**
 * Common ASR errors for Swahili financial terms.
 * Maps misheard words to their correct forms.
 */
export const ASR_ERROR_CORRECTIONS: ReadonlyMap<string, string> = new Map([
  ["micopo", "mikopo"],
  ["m'kopo", "mkopo"],
  ["reba", "riba"],
  ["reeba", "riba"],
  ["bianshara", "biashara"],
  ["dhamanna", "dhamana"],
  ["akanti", "akaunti"],
  ["akaundi", "akaunti"],
  ["malippo", "malipo"],
  ["mtahji", "mtaji"],
  ["leseeni", "leseni"],
  ["shilingi", "shilingi"],
  ["ashilimia", "asilimia"],
  ["kilwango", "kiwango"],
  ["faitha", "faida"],
  ["hassara", "hasara"],
  ["arebani", "rehani"],
  ["rehanni", "rehani"],
  ["bema", "bima"],
  ["kodhi", "kodi"],
  ["ujasiriamalii", "ujasiriamali"],
  ["upasiriamali", "ujasiriamali"],
  ["mshahala", "mshahara"],
  ["nyalaka", "nyaraka"],
  ["idhni", "idhini"],
]);

// ============================================================================
// Common Swahili Function Words (for code-switching detection)
// ============================================================================

export const COMMON_SWAHILI_WORDS: readonly string[] = [
  "na",
  "ya",
  "wa",
  "ni",
  "kwa",
  "katika",
  "au",
  "lakini",
  "kama",
  "ili",
  "hii",
  "hilo",
  "mimi",
  "wewe",
  "yeye",
  "sisi",
  "wao",
  "kuwa",
  "kwenda",
  "kuja",
  "kufanya",
  "kupata",
  "kusema",
  "kubwa",
  "ndogo",
  "nzuri",
  "mbaya",
  "sana",
  "kidogo",
  "haraka",
  "leo",
  "jana",
  "kesho",
  "sasa",
  "baadaye",
  "habari",
  "asante",
  "tafadhali",
  "karibu",
  "ndiyo",
  "hapana",
  "sawa",
  "basi",
  "je",
  "gani",
  "nini",
  "nani",
  "wapi",
  "lini",
  "vipi",
  "pesa",
  "fedha",
  "benki",
  "mkopo",
  "riba",
  "biashara",
  "mtaji",
  "faida",
  "hasara",
  "akaunti",
  "malipo",
  "dhamana",
  "kiwango",
  "asilimia",
  "shilingi",
  "hati",
  "leseni",
  "kampuni",
  "shirika",
];

// ============================================================================
// Extra English Financial Terms (for code-switching detection)
// ============================================================================

export const EXTRA_ENGLISH_FINANCIAL: readonly string[] = [
  "interest",
  "rate",
  "loan",
  "collateral",
  "mortgage",
  "insurance",
  "premium",
  "deposit",
  "withdrawal",
  "balance",
  "statement",
  "credit",
  "debit",
  "overdraft",
  "guarantee",
  "guarantor",
  "principal",
  "maturity",
  "amortization",
  "default",
  "arrears",
  "disbursement",
  "repayment",
  "installment",
  "portfolio",
  "equity",
  "dividend",
  "capital",
  "asset",
  "liability",
  "revenue",
  "profit",
  "loss",
  "audit",
  "compliance",
  "regulation",
  "assessment",
  "appraisal",
  "valuation",
  "invoice",
  "receipt",
  "budget",
  "forecast",
  "cashflow",
  "liquidity",
  "solvency",
  "bankruptcy",
  "restructuring",
  "refinancing",
  "syndication",
];
