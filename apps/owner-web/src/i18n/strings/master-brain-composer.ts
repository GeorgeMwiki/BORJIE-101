/**
 * master-brain-composer — per-surface {en, sw} string module for the
 * master-brain ChatPanel `Composer`.
 *
 * WHY THIS FILE EXISTS
 * The composer hardcoded English for the textarea placeholder, the
 * Send/Stop button captions + aria-labels, and the two zod validation
 * messages — with no locale prop at all. The zero-mix canon requires one
 * language per active locale, so these keys carry clean EN/SW pairs picked
 * via `pickByLocale`, mirroring `ask/AskComposer.tsx`. A NEW per-surface
 * file (not the shared bundles) keeps this stream conflict-free.
 */

export const masterBrainComposerStrings = {
  placeholder: {
    en: 'Ask the Master Brain — Swahili or English. Enter to send, Shift+Enter for a new line.',
    sw: 'Muulize Ubongo Mkuu — Kiswahili au Kiingereza. Enter kutuma, Shift+Enter mstari mpya.',
  },
  emptyError: {
    en: 'Type a question to send.',
    sw: 'Andika swali ili kutuma.',
  },
  tooLongError: {
    en: 'Keep prompts under 2000 chars.',
    sw: 'Weka maswali chini ya herufi 2000.',
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
  /** BreadcrumbStrip — live junior-agent call trace above the transcript. */
  breadcrumbJuniorCalls: {
    en: 'Junior calls',
    sw: 'Miito ya wasaidizi',
  },
  breadcrumbRouting: {
    en: 'Routing…',
    sw: 'Inaelekeza…',
  },
  breadcrumbIdle: {
    en: 'Idle.',
    sw: 'Tuli.',
  },
} as const;
