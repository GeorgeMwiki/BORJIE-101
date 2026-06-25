/**
 * routes-group-error.ts — guard-exempt bilingual (sw / en) copy for the
 * owner cockpit `(routes)` GROUP error boundary
 * (`app/(routes)/error.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so the Swahili literals the group boundary needs live
 * here rather than inline in the component — keeping the boundary source
 * free of hardcoded Swahili tokens.
 *
 * Unlike the ROOT boundary (`app/error.tsx`, copy in `routes-b.ts`),
 * this group boundary is SHELL-PRESERVING: the cockpit chrome / nav from
 * the root layout stays mounted and only the routed content area is
 * replaced by a DS `Alert`. The copy therefore says "this section" — not
 * "this page" — and offers a retry that re-renders the segment in place.
 *
 * The boundary renders exactly ONE language (chosen from the
 * `borjie_locale` cookie via `pickByLocale`), never a concatenated EN/SW
 * string (hard rule).
 */

export const routesGroupErrorStrings = {
  /** Alert title (DS `Alert` `title` prop). */
  title: {
    sw: 'Sehemu hii haikupakia.',
    en: "This section didn't load.",
  },
  /** Alert body — reassuring, never accusatory. */
  body: {
    sw: 'Tumeirekodi hitilafu. Jaribu tena. Ikiendelea, timu yetu tayari inaichunguza.',
    en: "We've logged the error. Try again. If it keeps happening, our team is already looking into it.",
  },
  /** Primary retry CTA. */
  retry: { sw: 'Jaribu tena', en: 'Try again' },
  /** Secondary CTA back to the cockpit home. */
  backToCockpit: { sw: 'Rudi kwenye dashibodi', en: 'Back to cockpit' },
} as const;
