import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { SalesSurface } from './SalesSurface';

/**
 * O-W-13 — Sales & pipeline.
 *
 * Server wrapper: resolves the borjie_locale cookie ONCE on the server and
 * seeds the client SalesSurface so its first paint matches the SSR
 * `<html lang>` chrome (no EN-under-SW split-brain). All live data + copy
 * live inside the surface.
 */
export default async function SalesPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return <SalesSurface initialLocale={initialLocale} />;
}
