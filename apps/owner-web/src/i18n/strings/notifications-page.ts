/**
 * notifications-page — guard-exempt Swahili+English string table for the
 * owner-web notifications inbox route (`app/(routes)/notifications/page.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the notifications page renders
 * (the page title + the live-activity subtitle) lives here rather than
 * inline in the route — keeping the route source free of hardcoded
 * Swahili tokens while preserving the symmetric
 * `pickByLocale(locale, S.key)` call-site shape the page already uses.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`. The EN and SW text is the
 * exact copy previously inlined in the route — preserved verbatim.
 */

export const notificationsPageStrings = {
  title: { en: 'Notifications', sw: 'Arifa' },
  subtitle: {
    en: 'Live activity from your sites — decisions, reminders, manager escalations, RFB dispatches, payroll commits, regulator requests.',
    sw: 'Shughuli za moja kwa moja kutoka kwa maeneo yako — maamuzi, vikumbusho, upandishaji wa meneja, uwasilishaji wa RFB, ahadi za malipo, maombi ya mdhibiti.',
  },
} as const;
