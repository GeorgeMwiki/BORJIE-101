/**
 * chat-modes — guard-exempt bilingual strings for the pedagogical chat
 * layouts mounted into HomeChatTeach (teaching · quiz · review ·
 * discussion). The `@borjie/chat-ui` layout components accept an optional
 * `Translator`; here we build one that resolves the `chatUi.*` label keys
 * those components request into locale-pure copy.
 *
 * Lives under `i18n/` so the locale-purity scanner skips it — the
 * sanctioned home for the Swahili+English literals these layouts need,
 * keeping ZERO Swahili tokens in `HomeChatTeach.tsx` / `ChatModeSurface`.
 *
 * Each entry is a `{ sw, en }` pair keyed by the exact label key the
 * package's `tr()` helper looks up. `makeChatModeTranslator(locale)`
 * returns a `Translator` (the package's `(key, vars?) => string` shape):
 * unknown keys fall through to the key itself so the package's own
 * English `DEFAULT_LABELS` can never be reintroduced as a mixed locale.
 *
 * Convention mirrors `i18n/strings/doc-upload.ts`.
 */

import type { Translator } from '@borjie/chat-ui';

type ChatModeLocale = 'sw' | 'en';

interface BilingualString {
  readonly sw: string;
  readonly en: string;
}

/**
 * Label catalog. Keys MUST match the `chatUi.*` keys requested by the
 * mounted layouts in `@borjie/chat-ui/src/chat-modes/*`:
 *  - TeachingModeLayout  → chatUi.teaching.*
 *  - QuizLockdownOverlay → chatUi.quiz.*
 *  - ReviewModeSummary   → chatUi.review.*
 *  - DiscussionModeLayout→ chatUi.discussion.*
 */
const chatModeStrings = {
  // --- Teaching mode -------------------------------------------------
  'chatUi.teaching.keyPoints': { sw: 'Mambo muhimu', en: 'Key points' },
  'chatUi.teaching.bloomRemember': { sw: 'Kumbuka', en: 'Remember' },
  'chatUi.teaching.bloomUnderstand': { sw: 'Elewa', en: 'Understand' },
  'chatUi.teaching.bloomApply': { sw: 'Tumia', en: 'Apply' },
  'chatUi.teaching.bloomAnalyze': { sw: 'Changanua', en: 'Analyze' },
  'chatUi.teaching.bloomEvaluate': { sw: 'Tathmini', en: 'Evaluate' },
  'chatUi.teaching.bloomCreate': { sw: 'Buni', en: 'Create' },
  'chatUi.teaching.conceptProgress': {
    sw: 'Dhana {current} kati ya {total}',
    en: 'Concept {current} of {total}',
  },
  'chatUi.teaching.participantsLearning': {
    sw: 'Wanafunzi {count} wanaendelea',
    en: '{count} learners active',
  },

  // --- Quiz lockdown -------------------------------------------------
  'chatUi.quiz.lockdown': {
    sw: 'Jaribio limefungwa: jibu ili kuendelea',
    en: 'Quiz locked: answer to continue',
  },
  'chatUi.quiz.answerSubmitted': { sw: 'Jibu limewasilishwa', en: 'Answer submitted' },
  'chatUi.quiz.points': { sw: 'pointi', en: 'pts' },
  'chatUi.quiz.timeExtended': { sw: 'Muda umeongezwa', en: 'Time extended' },
  'chatUi.quiz.option': { sw: 'Chaguo', en: 'Option' },
  'chatUi.quiz.difficultyBasic': { sw: 'Msingi', en: 'Basic' },
  'chatUi.quiz.difficultyMedium': { sw: 'Wastani', en: 'Medium' },
  'chatUi.quiz.difficultyPro': { sw: 'Mtaalamu', en: 'Pro' },

  // --- Review summary ------------------------------------------------
  'chatUi.review.title': { sw: 'Muhtasari wa kipindi', en: 'Session summary' },
  'chatUi.review.overallScore': { sw: 'Alama kwa jumla', en: 'Overall score' },
  'chatUi.review.masteryDelta': { sw: 'Mabadiliko ya umahiri', en: 'Mastery change' },
  'chatUi.review.conceptsCovered': { sw: 'Dhana zilizofunzwa', en: 'Concepts covered' },
  'chatUi.review.quizAccuracy': { sw: 'Usahihi wa jaribio', en: 'Quiz accuracy' },
  'chatUi.review.bloomReached': {
    sw: 'Kiwango cha Bloom kilichofikiwa',
    en: 'Bloom level reached',
  },
  'chatUi.review.misconceptions': {
    sw: 'Dhana potofu zilizorekebishwa',
    en: 'Misconceptions addressed',
  },
  'chatUi.review.recommendedReview': { sw: 'Mapitio yanayofuata', en: 'Next review' },
  'chatUi.review.redo': { sw: 'Rudia kipindi', en: 'Redo session' },
  'chatUi.review.next': { sw: 'Dhana inayofuata', en: 'Next concept' },
  'chatUi.review.nextConcepts': {
    sw: 'Dhana zinazopendekezwa zifuatazo',
    en: 'Recommended next concepts',
  },

  // --- Discussion ----------------------------------------------------
  'chatUi.discussion.title': { sw: 'Majadiliano', en: 'Discussion' },
  'chatUi.discussion.handRaised': {
    sw: 'Mikono {count} imeinuliwa',
    en: '{count} hand raised',
  },
  'chatUi.discussion.raiseHand': { sw: 'Inua mkono', en: 'Raise hand' },
  'chatUi.discussion.empty': {
    sw: 'Hakuna majibu bado. Shiriki mawazo yako.',
    en: 'No replies yet. Share your thoughts.',
  },
} as const satisfies Record<string, BilingualString>;

export type ChatModeStringKey = keyof typeof chatModeStrings;

function isChatModeKey(key: string): key is ChatModeStringKey {
  return Object.prototype.hasOwnProperty.call(chatModeStrings, key);
}

function fill(
  template: string,
  vars?: Readonly<Record<string, string | number>>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

/**
 * Build a `Translator` for the active locale. Resolves the layouts'
 * `chatUi.*` keys to locale-pure copy and fills `{token}` slots. A key
 * the catalog does not know returns the key verbatim (never the other
 * locale), so a future label addition surfaces as an obvious gap to QA
 * rather than silently leaking English into a Swahili render.
 */
export function makeChatModeTranslator(locale: ChatModeLocale): Translator {
  return (key, vars) => {
    if (!isChatModeKey(key)) return key;
    return fill(chatModeStrings[key][locale], vars);
  };
}
