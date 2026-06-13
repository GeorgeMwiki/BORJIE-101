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

  // --- Dispatcher-gate UI (TZ5): per-channel on/off, template opt-outs, and a
  // quiet-hours window. These drive /api/v1/me/notification-preferences, the
  // table the notification dispatcher's shouldDeliver gate consults. Keys are
  // scoped under explicit names so they never collide with the legacy
  // channel-priority copy above (or with reminders/escalations panels).
  deliveryHeading: {
    en: 'Delivery preferences',
    sw: 'Mapendeleo ya utumaji',
  },
  deliverySubtitle: {
    en: 'Turn channels off to stop delivery on them. Off everywhere stops a notification entirely.',
    sw: 'Zima njia ili kuacha kutuma kupitia kwazo. Zikizimwa zote, arifa haitumwi kabisa.',
  },
  channelOnOffSection: {
    en: 'Channels',
    sw: 'Njia',
  },
  channelEnabled: { en: 'On', sw: 'Imewashwa' },
  channelDisabled: { en: 'Off', sw: 'Imezimwa' },
  channelToggleAria: (label: string) => ({
    en: `Toggle delivery on ${label}`,
    sw: `Geuza utumaji kwenye ${label}`,
  }),

  // Push is the fourth dispatcher channel (the legacy priority list does not
  // include it, so its label lives here too).
  channelPushEn: 'Push',
  channelPushSw: 'Arifa za papo (push)',
  channelInAppNote: {
    en: 'In-app notifications are always delivered and cannot be turned off.',
    sw: 'Arifa za ndani ya programu hutumwa kila wakati na haziwezi kuzimwa.',
  },

  templatesSection: {
    en: 'Notification types',
    sw: 'Aina za arifa',
  },
  templatesSubtitle: {
    en: 'Mute specific notification types across every channel.',
    sw: 'Nyamazisha aina maalum za arifa kwenye kila njia.',
  },
  templateToggleAria: (label: string) => ({
    en: `Toggle the ${label} notification type`,
    sw: `Geuza aina ya arifa ya ${label}`,
  }),
  templateLabel: (key: string) => {
    const map: Record<string, { en: string; sw: string }> = {
      'licence.expiry_warning': {
        en: 'Licence expiry warning',
        sw: 'Onyo la kuisha kwa leseni',
      },
      'licence.renewal_status_changed': {
        en: 'Licence renewal status change',
        sw: 'Mabadiliko ya hali ya kuhuisha leseni',
      },
      'escalation.manager': {
        en: 'Escalation to manager',
        sw: 'Kupandisha kwa meneja',
      },
      'invoice.sent': { en: 'Invoice sent', sw: 'Ankara imetumwa' },
      'invoice.paid': { en: 'Invoice paid', sw: 'Ankara imelipwa' },
      'marketplace.inquiry.create': {
        en: 'Marketplace inquiry',
        sw: 'Ulizo la sokoni',
      },
    };
    return map[key] ?? { en: key, sw: key };
  },

  quietHoursSection: {
    en: 'Quiet hours',
    sw: 'Saa za utulivu',
  },
  quietHoursSubtitle: {
    en: 'A window when non-urgent notifications are held. Set both ends, or clear both to disable.',
    sw: 'Kipindi ambacho arifa zisizo za dharura zinazuiliwa. Weka pande zote mbili, au futa zote ili kuzima.',
  },
  quietHoursStartLabel: { en: 'Start', sw: 'Mwanzo' },
  quietHoursEndLabel: { en: 'End', sw: 'Mwisho' },
  quietHoursClear: { en: 'Clear quiet hours', sw: 'Futa saa za utulivu' },
  quietHoursPairError: {
    en: 'Set both the start and end of quiet hours, or clear both.',
    sw: 'Weka mwanzo na mwisho wa saa za utulivu, au futa zote mbili.',
  },
} as const;
