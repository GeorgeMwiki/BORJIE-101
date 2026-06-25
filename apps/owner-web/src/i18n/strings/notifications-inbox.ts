/**
 * notifications-inbox — guard-exempt Swahili+English string table for the
 * owner-web `NotificationsInbox`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the inbox needs (live/reconnecting
 * status, the interpolated unread badge, the mark-all action, and the empty
 * state) lives here rather than inline in the component — keeping the inbox
 * source free of hardcoded Swahili tokens while preserving the symmetric
 * `pickByLocale(locale, S[k])` call-site shape the inbox already uses.
 *
 * SHAPE
 * A flat record. Static leaves are `{ en, sw }`. Interpolated leaves are
 * arrow functions returning `{ en, sw }`. The EN and SW text is the exact
 * copy previously inlined in the component — preserved verbatim.
 */

export const notificationsInboxStrings = {
  live: { en: 'Live', sw: 'Moja kwa moja' },
  reconnecting: { en: 'Reconnecting…', sw: 'Inaunganisha tena…' },
  unread: (count: number) => ({
    en: `${count} unread`,
    sw: `${count} hazijasomwa`,
  }),
  markAllRead: { en: 'Mark all read', sw: 'Weka zote zimesomwa' },
  // Honest scope note: this inbox renders the LIVE cockpit event stream
  // for the current session. There is no persisted cockpit-event history
  // endpoint yet, so events received before this session are not shown.
  liveSessionNote: {
    en: 'Showing live events from this session.',
    sw: 'Inaonyesha matukio ya moja kwa moja ya kipindi hiki.',
  },
  emptyTitle: { en: 'No notifications yet', sw: 'Hakuna arifa bado' },
  empty: {
    en: 'No live events yet. We will show every decision, reminder, handoff and regulator request here as soon as it lands.',
    sw: 'Hakuna matukio bado. Tutaonyesha kila uamuzi, ukumbusho, uhamisho, na ombi la mdhibiti hapa mara inapofika.',
  },
  // Humanized title for each cockpit SSE event kind. The list previously
  // rendered the raw enum token (e.g. `decision.recorded`) — these are the
  // localized labels keyed by CockpitEventKind. An unknown kind falls back
  // to `eventKindUnknown` (never the raw English token).
  eventKind: {
    'decision.recorded': { en: 'Decision recorded', sw: 'Uamuzi umerekodiwa' },
    'reminder.fired': { en: 'Reminder fired', sw: 'Ukumbusho umetumwa' },
    'opportunity.scan_completed': {
      en: 'Opportunity scan complete',
      sw: 'Uchanganuzi wa fursa umekamilika',
    },
    'risk.changed': { en: 'Risk changed', sw: 'Hatari imebadilika' },
    'workforce.shift_event': { en: 'Shift event', sw: 'Tukio la zamu' },
    'compliance.deadline_approaching': {
      en: 'Compliance deadline approaching',
      sw: 'Tarehe ya kufuata sheria inakaribia',
    },
    'production.posted': { en: 'Production posted', sw: 'Uzalishaji umewekwa' },
    'cockpit.tab.spawned': { en: 'New tab created', sw: 'Kichupo kipya kimeundwa' },
    'cockpit.tab.updated': { en: 'Tab updated', sw: 'Kichupo kimesasishwa' },
    'cockpit.tab.removed': { en: 'Tab removed', sw: 'Kichupo kimeondolewa' },
    'cockpit.tab.proposed': { en: 'Tab proposed', sw: 'Kichupo kimependekezwa' },
  },
  eventKindUnknown: { en: 'Notification', sw: 'Arifa' },
} as const;
