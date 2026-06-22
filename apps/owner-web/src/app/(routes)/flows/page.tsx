import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { FlowsSurface } from './FlowsSurface';

/**
 * Business flows — process compiler (slice 1).
 *
 * Server wrapper: resolves the borjie_locale cookie ONCE on the server and
 * seeds the client FlowsSurface so its first paint matches the SSR
 * `<html lang>` chrome (no EN-under-SW split-brain). All copy lives behind
 * the `flows.*` i18n keys inside the surface.
 */
export default async function FlowsPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return <FlowsSurface initialLocale={initialLocale} />;
}
