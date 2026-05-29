import { redirect } from 'next/navigation';
import { getOwnerSession } from '@/lib/session';
import { SW } from '@/lib/sw-tokens';
import { KioskClockInSurface } from './KioskClockInSurface';

/**
 * O-W-WORKFORCE-KIOSK — shared on-site terminal kiosk for clocking
 * crews in/out via WebAuthn (Touch ID / Windows Hello). This route
 * closes R30 from `Docs/ROADMAP.md` — the `WebAuthnClockIn`
 * component was already polished + integration-tested but lacked a
 * host page; the owner-web workforce surface now exposes it at
 * `/workforce-tabs/kiosk`.
 *
 * Auth model: same `getOwnerSession()` gate as the parent
 * `/workforce-tabs` page (manager / supervisor / owner roles).
 * Worker identity is selected at the kiosk by the supervisor on
 * shift; the WebAuthn passkey then asserts presence + consent for
 * the clock-in event. The downstream `/api/v1/workforce/clock-in`
 * endpoint records `actorId = session.userId` (the supervisor) so
 * the audit chain shows BOTH the WebAuthn passkey AND the assisting
 * supervisor.
 */
export default async function WorkforceKioskPage(): Promise<JSX.Element> {
  const session = await getOwnerSession();
  if (!session.sites || session.sites.length === 0) {
    redirect('/workforce-tabs');
  }
  const isSw = session.languagePreference === 'sw';

  const sites = session.sites.map((site) => ({
    id: site.id,
    label: site.name,
  }));

  return (
    <div className="space-y-6 px-8 py-8">
      <header className="space-y-2">
        <p className="font-mono text-xs text-neutral-500">O-W-WORKFORCE-KIOSK</p>
        <h1 className="font-display text-2xl text-foreground">
          {isSw ? `Kiosk ya ${SW.workforce}` : 'Workforce kiosk'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSw
            ? 'Mfanyikazi anaweza kuingia/kutoka kazini kupitia Touch ID au Windows Hello kwenye kompyuta ya msingi.'
            : 'Workers clock in/out from this shared terminal using Touch ID or Windows Hello — no phone required.'}
        </p>
      </header>

      <KioskClockInSurface sites={sites} isSw={isSw} />
    </div>
  );
}
