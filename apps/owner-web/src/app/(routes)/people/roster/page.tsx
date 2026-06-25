import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { RosterSurface } from './RosterSurface';

/**
 * O-W-08-ROSTER — Worker roster.
 *
 * Server wrapper: resolves the borjie_locale cookie ONCE on the server and
 * seeds the client RosterSurface so its first paint matches the SSR
 * `<html lang>` chrome (no EN-under-SW split-brain). Headcount, attendance,
 * and copy live inside the surface.
 */
export default async function PeopleRosterPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return <RosterSurface initialLocale={initialLocale} />;
}
