/**
 * ask-empty-state — guard-exempt Swahili+English string table for the
 * ask-Borjie `AskEmptyState` panels and the `AskBorjieSurface` host chrome.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal these surfaces need lives here
 * rather than inline in the components — keeping the source free of
 * hardcoded Swahili tokens while preserving the symmetric
 * `pickByLocale(locale, S[k])` call-site shape. The toggle is ABSOLUTE:
 * when `en` is active zero Swahili renders, and vice versa.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`.
 */

export const askEmptyStateStrings = {
  // — unconfigured panel —
  unconfiguredTitle: {
    en: 'Connect to Borjie backend',
    sw: 'Unganisha na seva ya Borjie',
  },
  unconfiguredBodyBefore: {
    en: 'The owner cockpit is not pointed at a Borjie api-gateway yet. Set the',
    sw: 'Cockpit ya mmiliki bado haijaelekezwa kwenye api-gateway ya Borjie. Weka',
  },
  unconfiguredBodyMiddle: {
    en: 'environment variable to the gateway base URL (e.g.',
    sw: 'kigezo cha mazingira kuwa anwani ya msingi ya gateway (mfano',
  },
  unconfiguredBodyAfter: {
    en: ') and reload to start chatting with the Brain.',
    sw: ') kisha pakia upya ili kuanza kuzungumza na Ubongo.',
  },

  // — unauthenticated panel —
  unauthenticatedTitle: {
    en: 'Sign in required',
    sw: 'Inahitaji kuingia',
  },
  unauthenticatedBody: {
    en: 'Borjie Brain needs an authenticated Supabase session. Sign in again from the top-right to refresh your token, then come back to this page.',
    sw: 'Ubongo wa Borjie unahitaji kipindi cha Supabase kilichothibitishwa. Ingia tena kutoka juu-kulia ili kuburudisha tokeni yako, kisha rudi kwenye ukurasa huu.',
  },

  // — error panel —
  errorTitle: {
    en: 'Brain unreachable',
    sw: 'Ubongo haupatikani',
  },
  errorBody: {
    en: 'The gateway returned an error. Try again, or contact your Borjie operator if it persists.',
    sw: 'Gateway imerudisha hitilafu. Jaribu tena, au wasiliana na opereta wako wa Borjie kama itaendelea.',
  },

  // — fresh / intro panel —
  freshTitle: {
    en: 'Ask Borjie Brain',
    sw: 'Uliza Ubongo wa Borjie',
  },
  freshBody: {
    en: 'Ask anything about your mining portfolio. Replies cite the corpus chunk they came from (mineral code · section · score) so you can trace the answer back to source. Swahili and English are both fine.',
    sw: 'Uliza chochote kuhusu portfolio yako ya madini. Majibu yanataja kipande cha korasi yalikotoka (msimbo wa madini · sehemu · alama) ili uweze kufuatilia jibu hadi chanzo. Kiswahili na Kiingereza vyote vinafaa.',
  },
  freshExample1: {
    en: '· "Show me sites running below the gold target this week."',
    sw: '· "Nionyeshe migodi inayozalisha chini ya lengo la dhahabu wiki hii."',
  },
  freshExample2: {
    en: '· "Which licences expire within 30 days?"',
    sw: '· "Ni leseni zipi zinazoisha ndani ya siku 30?"',
  },
  freshExample3: {
    en: '· "What did the auditor flag yesterday?"',
    sw: '· "Mkaguzi aliashiria nini jana?"',
  },

  // — host chrome (AskBorjieSurface) —
  surfaceTitle: {
    en: 'Ask Borjie Brain',
    sw: 'Uliza Ubongo wa Borjie',
  },
  surfaceLiveWire: {
    en: 'Live wire to',
    sw: 'Muunganisho wa moja kwa moja kwa',
  },
  surfaceThread: {
    en: 'thread',
    sw: 'mazungumzo',
  },
  surfaceNewThread: {
    en: 'New thread',
    sw: 'Mazungumzo mapya',
  },
  surfaceLoadingHistory: {
    en: 'Loading thread history…',
    sw: 'Inapakia historia ya mazungumzo…',
  },
} as const;
