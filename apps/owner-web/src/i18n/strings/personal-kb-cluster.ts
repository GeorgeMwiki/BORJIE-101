/**
 * personal-kb-cluster — guard-exempt bilingual (sw / en) copy for the
 * personal-KB surfaces, isolated from the shared `routes-a` bundle so
 * parallel streams don't collide.
 *
 * WHY THIS FILE EXISTS
 * The detail panel's CONSENT_REQUIRED branch used to direct the owner to
 * a "Settings → Share consent" screen that DOES NOT EXIST, and offered no
 * action — a dead-end. There is no consent-grant endpoint in the gateway
 * (`personal-kb.hono.ts` is GET-only). Until a grant capability ships,
 * the honest state explains that consent has not been granted and that it
 * cannot be granted from here yet — pointing the owner nowhere phantom and
 * exposing no no-op control. Lives under `i18n/` so the locale-purity
 * scanner exempts the Swahili.
 */

export const personalKbClusterStrings = {
  // ── Consent gate — honest state (no dead-end navigation) ───────────
  consentTitle: { en: 'Consent required', sw: 'Idhini inahitajika' },
  consentBody: {
    en: 'Reading your personal memory cells needs your affirmative consent. Consent has not been granted on this account.',
    sw: 'Kusoma kumbukumbu zako za kibinafsi kunahitaji idhini yako. Idhini haijatolewa kwenye akaunti hii.',
  },
  // Honest capability note: there is no grant action wired yet, so we do
  // NOT render a button that no-ops. We tell the owner where it will live.
  consentNotAvailable: {
    en: 'Granting consent is not available here yet — it will be offered when the unified-KB consent control ships. No memory cells are read until you opt in.',
    sw: 'Kutoa idhini hakupatikani hapa bado — kutapatikana pindi kidhibiti cha idhini ya maktaba moja kitakapotolewa. Hakuna kumbukumbu inayosomwa hadi uruhusu.',
  },
} as const;
