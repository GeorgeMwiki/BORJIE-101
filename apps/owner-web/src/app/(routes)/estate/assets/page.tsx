import { PageHero } from '@/components/shared/PageHero';
import { AssetsRegister } from '@/components/estate/AssetsRegister';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-31 — Asset register.
 *
 * Consolidated asset register table with class filter and a current-
 * value summary. Mining licences, land, buildings, plant, vehicles,
 * inventory, financial instruments, IP, goodwill, crypto.
 *
 * Live data path:
 *   GET /api/v1/estate/assets
 */
export default async function EstateAssetsPage(): Promise<JSX.Element> {
  const session = await getOwnerSession();
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="estate/assets" />
      <AssetsRegister locale={session.languagePreference} />
    </div>
  );
}
