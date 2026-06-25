/**
 * ask-composer — guard-exempt Swahili+English string table for the
 * ask-Borjie `AskComposer`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the composer needs (textarea
 * placeholder + aria-label, the stop/send aria-labels and button captions)
 * lives here rather than inline in the component — keeping the composer
 * source free of hardcoded Swahili tokens while preserving the symmetric
 * `pickByLocale(locale, S[k])` call-site shape.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`. The EN and SW text is the exact
 * copy previously inlined in the component — preserved verbatim.
 */

export const askComposerStrings = {
  placeholder: {
    en: 'Ask Mr. Mwikila — Swahili or English. Enter to send, Shift+Enter for a new line.',
    sw: 'Muulize Bw. Mwikila — Kiswahili au Kiingereza. Enter kutuma, Shift+Enter mstari mpya.',
  },
  textareaAria: {
    en: 'Ask Mr. Mwikila',
    sw: 'Muulize Bw. Mwikila',
  },
  stopAria: {
    en: 'Stop generating',
    sw: 'Simamisha kuzalisha',
  },
  stop: {
    en: 'Stop',
    sw: 'Simamisha',
  },
  sendAria: {
    en: 'Send message',
    sw: 'Tuma ujumbe',
  },
  send: {
    en: 'Send',
    sw: 'Tuma',
  },
} as const;
