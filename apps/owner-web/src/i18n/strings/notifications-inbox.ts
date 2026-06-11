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
  empty: {
    en: 'No live events yet. We will show every decision, reminder, handoff and regulator request here as soon as it lands.',
    sw: 'Hakuna matukio bado. Tutaonyesha kila uamuzi, ukumbusho, uhamisho, na ombi la mdhibiti hapa mara inapofika.',
  },
} as const;
