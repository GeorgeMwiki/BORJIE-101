/**
 * living-plan-panel — guard-exempt Swahili+English string table for the
 * owner-cockpit `LivingPlanPanel`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the panel needs (header copy,
 * health-meter labels, GTD section titles, status / trigger glosses,
 * error / empty copy) lives here rather than inline in the component —
 * keeping the panel source free of hardcoded Swahili tokens while
 * preserving the strict single-language-per-locale render (an `en`
 * session shows zero Swahili and a `sw` session shows zero English).
 *
 * SHAPE
 * Namespaced object. Each leaf is `{ en, sw }`, resolved at the call
 * site through `pickByLocale(locale, leaf)`. The exact `en` and `sw`
 * text is preserved verbatim from the original inline copy.
 */

export const livingPlanPanelStrings = {
  // ── Header ───────────────────────────────────────────────────────────
  eyebrow: { en: 'Mr. Mwikila', sw: 'Bw. Mwikila' },
  heading: { en: 'Living plan', sw: 'Mpango hai' },
  gloss: {
    en: 'Every commitment Mr. Mwikila is holding for you — what is next, what he is waiting on, and what is already done.',
    sw: 'Kila ahadi Bw. Mwikila anayoishikilia kwa niaba yako — kinachofuata, anachosubiri, na kilichokamilika.',
  },

  // ── Health meter ─────────────────────────────────────────────────────
  health: { en: 'Plan health', sw: 'Afya ya mpango' },
  progressLabel: { en: 'Completed', sw: 'Imekamilika' },
  open: { en: 'Open', sw: 'Wazi' },
  done: { en: 'Done', sw: 'Imekamilika' },
  overdue: { en: 'Overdue', sw: 'Imechelewa' },
  deferred: { en: 'Someday', sw: 'Siku moja' },
  blocked: { en: 'Blocked', sw: 'Imezuiwa' },
  nextDue: { en: 'Next due', sw: 'Inayofuata' },

  // ── GTD section titles ───────────────────────────────────────────────
  nextActions: { en: 'Next actions', sw: 'Hatua zinazofuata' },
  waitingFor: { en: 'Waiting for', sw: 'Inasubiri' },
  ticklerUpcoming: { en: 'Upcoming', sw: 'Zinazokuja' },
  somedaySection: { en: 'Someday', sw: 'Siku moja' },
  overdueSection: { en: 'Overdue', sw: 'Imechelewa' },
  pastSection: { en: 'Completed', sw: 'Zilizokamilika' },

  // ── Row badges + trigger glosses ─────────────────────────────────────
  sovereign: { en: 'Owner sign-off', sw: 'Idhini ya mmiliki' },
  proofClosed: { en: 'Closed with proof', sw: 'Imefungwa kwa uthibitisho' },
  noTrigger: { en: 'No deadline set', sw: 'Hakuna tarehe ya mwisho' },
  whenEvent: { en: 'When', sw: 'Wakati' },
  dueOn: { en: 'Due', sw: 'Inastahili' },

  // ── Error + empty states ─────────────────────────────────────────────
  errorTitle: {
    en: 'Could not load your plan',
    sw: 'Imeshindwa kupakia mpango wako',
  },
  retry: { en: 'Try again', sw: 'Jaribu tena' },
  emptyAllClear: {
    en: 'Mr. Mwikila is keeping your plan — nothing due right now.',
    sw: 'Bw. Mwikila anashikilia mpango wako — hakuna kinachostahili sasa.',
  },
  emptySection: { en: 'Nothing here', sw: 'Hakuna chochote hapa' },

  // ── Status labels (per CommitmentStatus) ─────────────────────────────
  status: {
    open: { en: 'Open', sw: 'Wazi' },
    scheduled: { en: 'Scheduled', sw: 'Imepangwa' },
    overdue: { en: 'Overdue', sw: 'Imechelewa' },
    blocked: { en: 'Blocked', sw: 'Imezuiwa' },
    done: { en: 'Done', sw: 'Imekamilika' },
    reopened: { en: 'Reopened', sw: 'Imefunguliwa tena' },
    needs_approval: { en: 'Needs approval', sw: 'Inahitaji idhini' },
    dead_letter: { en: 'Needs triage', sw: 'Inahitaji ukaguzi' },
  },

  // ── Event-trigger glosses (the rest fall back to the raw key) ────────
  event: {
    'ledger.credit': { en: 'a payment lands', sw: 'malipo yanapokelewa' },
    'offtake.settled': { en: 'the off-take settles', sw: 'mauzo yanapokamilika' },
    'royalty.settled': { en: 'royalty settles', sw: 'mrabaha unapolipwa' },
  } as Record<string, { en: string; sw: string }>,
} as const;
