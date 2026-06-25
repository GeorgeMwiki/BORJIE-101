import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { NewIncidentSurface } from './NewIncidentSurface';

/**
 * O-W-15-NEW — Log new safety incident.
 *
 * Server wrapper: resolves the borjie_locale cookie ONCE on the server and
 * seeds the client NewIncidentSurface so its first paint matches the SSR
 * `<html lang>` chrome (no EN-under-SW split-brain). The form + copy live
 * inside the surface.
 */
export default async function NewIncidentPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return <NewIncidentSurface initialLocale={initialLocale} />;
}
