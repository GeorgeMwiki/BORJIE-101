import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { CompliancePackSurface } from './CompliancePackSurface';

/**
 * O-W-14-PACK — Monthly compliance pack.
 *
 * Server wrapper: resolves the borjie_locale cookie ONCE on the server and
 * seeds the client CompliancePackSurface so its first paint matches the SSR
 * `<html lang>` chrome (no EN-under-SW split-brain). The form, list, and copy
 * live inside the surface.
 */
export default async function CompliancePackPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return <CompliancePackSurface initialLocale={initialLocale} />;
}
