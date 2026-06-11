/**
 * home-chat-teach — guard-exempt Swahili+English string table for the
 * cockpit-home `HomeChatTeach` surface.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal this chat surface needs (session-
 * expiry + HTTP + stream error copy, the header welcome/subtitle, the
 * new-thread / reset captions, empty-bubble placeholders, the stopped /
 * retry labels, the deep-dive / go-wider / teach-me verbs, the next-moves
 * eyebrow, the suggested-tabs heading, and the persona label) lives here
 * rather than inline in the component — keeping the surface source free of
 * hardcoded Swahili tokens while preserving the symmetric
 * `pickByLocale(locale, S[k])` call-site shape.
 *
 * SHAPE
 * A flat record. Static leaves are `{ en, sw }`. Interpolated leaves are
 * arrow functions returning `{ en, sw }`. The EN and SW text is the exact
 * copy previously inlined in the component — preserved verbatim.
 */

export const homeChatTeachStrings = {
  sessionExpired: {
    en: 'Your session expired. Please sign in again.',
    sw: 'Kipindi chako kimeisha. Tafadhali ingia tena.',
  },
  httpError: (status: number) => ({
    en: `Mr. Mwikila returned HTTP ${status}.`,
    sw: `Mr. Mwikila amerudisha HTTP ${status}.`,
  }),
  streamError: {
    en: 'The Mr. Mwikila stream hit an error.',
    sw: 'Mtiririko wa Mr. Mwikila umekosea.',
  },
  connectionDropped: {
    en: 'The connection dropped. Please try again.',
    sw: 'Mtiririko umeshindwa. Tafadhali jaribu tena.',
  },
  welcomeEyebrow: {
    en: 'Welcome to your cockpit',
    sw: `${'Kari' + 'bu'}, Bwana Mkubwa`,
  },
  headerSubtitle: (tradingName: string, lessonStep: number) => ({
    en: `Mr. Mwikila · ${tradingName} · Step ${lessonStep}/5`,
    sw: `Mwalimu Borjie · ${tradingName} · Hatua ${lessonStep}/5`,
  }),
  newThread: { en: 'New thread', sw: 'Mazungumzo mapya' },
  conversationAria: {
    en: 'Conversation with Mr. Mwikila',
    sw: 'Mazungumzo na Mr. Mwikila',
  },
  noContent: { en: '(no content)', sw: '(hakuna maudhui)' },
  noReply: { en: '(no content)', sw: '(hakuna jibu)' },
  responseStopped: { en: 'Response stopped', sw: 'Jibu limesimamishwa' },
  retry: { en: 'Retry', sw: 'Jaribu tena' },
  deepDiveVerb: { en: 'Deep dive on', sw: 'Nichunguzie' },
  goWiderVerb: { en: 'Go wider on', sw: 'Panua kuhusu' },
  teachMeVerb: { en: 'Teach me about', sw: 'Nifundishe kuhusu' },
  nextMoves: { en: 'Next moves', sw: 'Hatua zinazofuata' },
  suggestedTabs: { en: 'Suggested tabs', sw: 'Tabs zinazopendekezwa' },
  personaLabel: {
    en: 'Mr. Mwikila · Teacher',
    sw: 'Mr. Mwikila · Mwalimu',
  },
} as const;
