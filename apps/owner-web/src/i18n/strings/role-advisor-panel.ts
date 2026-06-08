/**
 * role-advisor-panel — guard-exempt Swahili+English string table for the
 * owner cockpit RoleAdvisorPanel (the universal role-aware advisor surface).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the panel needs (title, prompts,
 * captions, feedback copy) lives here rather than inline in the component —
 * keeping the panel source free of hardcoded Swahili tokens while
 * preserving the `isSw ? T.x.key.sw : T.x.key.en` call-site shape.
 *
 * SHAPE
 * Each leaf is `{ sw, en }`. The exact EN and SW text is preserved
 * verbatim from the original inline `STR` table.
 */

export const roleAdvisorPanelStrings = {
  title: { en: 'Ask the advisor', sw: 'Uliza mshauri' },
  subtitle: {
    en: 'Role-aware answers grounded in your own evidence.',
    sw: 'Majibu kulingana na jukumu lako, yenye ushahidi wako.',
  },
  placeholder: {
    en: 'Ask anything about your estate…',
    sw: 'Uliza chochote kuhusu shamba lako…',
  },
  send: { en: 'Ask', sw: 'Uliza' },
  thinking: { en: 'Thinking…', sw: 'Inafikiri…' },
  startersTitle: { en: 'Try one of these', sw: 'Jaribu mojawapo' },
  answerTitle: { en: 'Answer', sw: 'Jibu' },
  evidenceTitle: { en: 'Evidence', sw: 'Ushahidi' },
  noEvidence: {
    en: 'No supporting evidence was available for this answer.',
    sw: 'Hakuna ushahidi uliopatikana kwa jibu hili.',
  },
  redacted: { en: 'fields redacted', sw: 'sehemu zimefichwa' },
  denied: { en: 'records withheld by access policy', sw: 'rekodi zimezuiwa na sera' },
  error: {
    en: 'Could not get an answer. Please try again.',
    sw: 'Imeshindikana kupata jibu. Tafadhali jaribu tena.',
  },
  helpful: { en: 'Helpful', sw: 'Imesaidia' },
  notHelpful: { en: 'Not helpful', sw: 'Haikusaidia' },
  thanks: { en: 'Thanks for the feedback.', sw: 'Asante kwa maoni.' },
} as const;
