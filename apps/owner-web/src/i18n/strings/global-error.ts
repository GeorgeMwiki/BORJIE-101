/**
 * global-error.ts — guard-exempt bilingual (sw / en) copy for the
 * owner cockpit ROOT error boundary (`app/global-error.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so the Swahili literals the root error boundary needs
 * live here rather than inline in the component — keeping the boundary
 * source free of hardcoded Swahili tokens. The boundary renders exactly
 * ONE language (chosen from the `borjie_locale` cookie via
 * `pickByLocale`), never a concatenated EN/SW string.
 *
 * The root boundary cannot rely on the i18n runtime (`t()`) — it mounts
 * when the root layout itself threw, before providers exist — so it
 * reads these static `{ sw, en }` pairs directly.
 */

export const globalErrorStrings = {
  eyebrow: { sw: 'Hitilafu kubwa', en: 'Critical error' },
  heading: {
    sw: 'Hatukuweza kupakia ukurasa huu.',
    en: "We couldn't load this page.",
  },
  body: {
    sw: 'Kitu kimeshindikana kabla hatujaonyesha chochote. Jaribu kupakia upya. Kama itaendelea, timu yetu tayari imearifiwa.',
    en: 'Something failed before we could render anything. Try reloading. If it keeps happening, our team has been notified.',
  },
  retry: { sw: 'Jaribu tena', en: 'Try again' },
} as const;
