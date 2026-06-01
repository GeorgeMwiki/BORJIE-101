import { WorkforceTabMatrix } from '@/components/workforce-tabs/WorkforceTabMatrix';
import { WorkforceTabRequestQueue } from '@/components/workforce-tabs/WorkforceTabRequestQueue';
import { getOwnerSession } from '@/lib/session';
import { SW } from '@/lib/sw-tokens';
import { routesBStrings as S } from '@/i18n/strings/routes-b';

/**
 * O-W-WORKFORCE-TABS — Workforce → Tab access configurator.
 *
 * Wave WORKFORCE-FIXED-TABS. The owner sets which fixed tabs each
 * worker role sees per site scope, and reviews change requests
 * submitted by workers from the workforce-mobile RequestTabChangeSheet.
 *
 * Layout: matrix on the left, pending-request queue on the right. The
 * chat / profile cells are locked (mandatory) per the catalog.
 */
export default async function WorkforceTabsPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';

  const siteScopes: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
    {
      id: 'global',
      label: isSw ? S.workforceTabs.scopeGlobal.sw : S.workforceTabs.scopeGlobal.en,
    },
    ...session.sites.map((site) => ({ id: site.id, label: site.name })),
  ];

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="space-y-2">
        <p className="font-mono text-xs text-neutral-500">O-W-WORKFORCE-TABS</p>
        <h1 className="font-display text-2xl text-foreground">
          {isSw
            ? S.workforceTabs.title.sw.replace('{workforce}', SW.workforce)
            : S.workforceTabs.title.en}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSw
            ? S.workforceTabs.body.sw.replace('{workforce}', SW.workforce)
            : S.workforceTabs.body.en}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <WorkforceTabMatrix siteScopes={siteScopes} isSw={isSw} />
        <WorkforceTabRequestQueue isSw={isSw} />
      </div>
    </div>
  );
}
