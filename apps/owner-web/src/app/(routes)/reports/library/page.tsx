import { ReportsLibrarySurface } from './ReportsLibrarySurface';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

/**
 * O-W-18-LIBRARY — server wrapper. Resolves the active locale ONCE on the
 * server so SSR and the first client render agree (no EN-under-SW
 * first-paint split-brain); the client surface reads it via
 * useLocale(initialLocale).
 */
export default async function ReportsLibraryPage() {
  const locale = await readLocaleFromServerCookies();
  return <ReportsLibrarySurface initialLocale={locale} />;
}
