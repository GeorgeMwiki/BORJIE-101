/**
 * notification-preferences-panel — guard-exempt Swahili+English string
 * table for the owner-settings `NotificationPreferencesPanel`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the notification-preferences
 * panel needs (channel labels, priority-ranking copy, contact-detail
 * field labels/placeholders, save/error captions, and the interpolated
 * move/remove aria-labels) lives here rather than inline in the
 * component — keeping the panel source free of hardcoded Swahili tokens
 * while preserving the symmetric `pickByLocale(locale, S[k])` call-site
 * shape the panel already uses.
 *
 * SHAPE
 * A flat record. Static leaves are `{ en, sw }`. Interpolated leaves are
 * arrow functions returning `{ en, sw }`. The EN and SW text is the exact
 * copy previously inlined in the component — preserved verbatim.
 */

export const notificationPreferencesPanelStrings = {
  // Per-channel Swahili display labels (English labels stay inline in the
  // component — they are English and allowed there).
  channelLabelSw: {
    email: 'Barua pepe',
    sms: 'Ujumbe mfupi (SMS)',
    slack: 'Slack',
    whatsapp: 'WhatsApp',
  },

  retry: { en: 'Retry', sw: 'Jaribu tena' },
  channelsHeading: { en: 'Notification channels', sw: 'Njia za arifa' },
  channelsSubtitle: {
    en: 'How Mr. Mwikila reaches you — ranked highest priority first.',
    sw: 'Jinsi Bw. Mwikila anavyowasiliana nawe — iliyopangwa kwa kipaumbele.',
  },
  priorityOrder: { en: 'Priority order', sw: 'Mpangilio wa kipaumbele' },
  noChannelsRanked: {
    en: 'No channels ranked. Add one below.',
    sw: 'Hakuna njia zilizopangwa. Ongeza moja hapa chini.',
  },
  addChannel: { en: 'Add channel', sw: 'Ongeza njia' },
  emailOverride: { en: 'Email override', sw: 'Barua pepe mbadala' },
  emailOverridePlaceholder: {
    en: 'Defaults to account email',
    sw: 'Msingi: barua pepe ya akaunti',
  },
  phoneLabel: { en: 'Phone (SMS / WhatsApp)', sw: 'Simu (SMS / WhatsApp)' },
  slackHandle: { en: 'Slack handle', sw: 'Jina la Slack' },
  timeZone: { en: 'Time zone', sw: 'Eneo la saa' },
  saving: { en: 'Saving…', sw: 'Inahifadhi…' },
  savePreferences: { en: 'Save preferences', sw: 'Hifadhi mapendeleo' },
  saved: { en: 'Saved', sw: 'Imehifadhiwa' },
  errorPrefix: { en: 'Error: ', sw: 'Hitilafu: ' },

  loadError: (message: string) => ({
    en: `Could not load notification preferences. ${message}`,
    sw: `Imeshindwa kupakia mapendeleo ya arifa. ${message}`,
  }),
  moveUpAria: (label: string) => ({
    en: `Move ${label} up`,
    sw: `Sogeza ${label} juu`,
  }),
  moveDownAria: (label: string) => ({
    en: `Move ${label} down`,
    sw: `Sogeza ${label} chini`,
  }),
  removeAria: (label: string) => ({
    en: `Remove ${label}`,
    sw: `Ondoa ${label}`,
  }),
} as const;
