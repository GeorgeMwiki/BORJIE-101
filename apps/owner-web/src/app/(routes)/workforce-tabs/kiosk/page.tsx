import { redirect } from 'next/navigation';
import { getOwnerSession } from '@/lib/session';
import { SW } from '@/lib/sw-tokens';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
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
        <p className="font-mono text-xs text-muted-foreground">O-W-WORKFORCE-KIOSK</p>
        <h1 className="font-display text-2xl text-foreground">
          {isSw
            ? S.kioskPage.title.sw.replace('{workforce}', SW.workforce)
            : S.kioskPage.title.en}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSw ? S.kioskPage.body.sw : S.kioskPage.body.en}
        </p>
      </header>

      <KioskClockInSurface sites={sites} isSw={isSw} />
    </div>
  );
}
