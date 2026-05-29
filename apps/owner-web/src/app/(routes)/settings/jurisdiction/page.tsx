import { JurisdictionSettings } from './jurisdiction-settings';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Eneo la sheria — Borjie',
};

/**
 * /settings/jurisdiction — JA-7.
 *
 * Owner-visible jurisdiction settings page. Surfaces:
 *   - tenant's current country, named regulators, currency,
 *     default language, time zone (live from /api/v1/me/jurisdiction)
 *   - LOCKED state notice — tenant.jurisdiction is locked at
 *     signup per migration 0149; permanent change goes through
 *     Borjie support (JC-7 four-eye admin path)
 *   - "Ask Mr. Mwikila about another jurisdiction for this
 *     conversation" CTA — points the owner at the brain's
 *     per-turn override (JC-6 mwikila.jurisdiction.switch)
 */
export default function JurisdictionSettingsPage() {
  return (
    <>
      <header className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-neutral-500">
            O-W-22.JURISDICTION
          </span>
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-badge text-neutral-400">
            Owner
          </span>
        </div>
        <h1 className="mt-1 font-display text-3xl text-foreground">
          Jurisdiction
        </h1>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          Eneo la sheria
        </p>
        <p className="mt-3 max-w-3xl text-sm text-neutral-300">
          Your account's country, regulators, currency, and time zone
          drive every royalty draft, licence reminder, and compliance
          filing Mr. Mwikila produces for you. The jurisdiction is
          locked at signup; ask in chat to answer for another country
          for a single turn.
        </p>
        <p className="mt-1 max-w-3xl text-sm italic text-neutral-500">
          Nchi ya akaunti yako, wadhibiti, sarafu, na eneo la saa
          huongoza kila rasimu ya mrabaha, kumbukumbu ya leseni, na
          ufaili wa utiifu. Eneo la sheria limefungwa wakati wa usajili;
          uliza katika mazungumzo kujibu kwa nchi nyingine kwa zamu moja.
        </p>
      </header>
      <div className="px-8 py-6">
        <JurisdictionSettings />
      </div>
    </>
  );
}
