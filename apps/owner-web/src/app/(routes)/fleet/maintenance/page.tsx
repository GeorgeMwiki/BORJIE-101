import { MaintenancePageBody } from './MaintenancePageBody';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

/**
 * Fleet maintenance — server wrapper. Resolves the active locale ONCE on
 * the server so SSR and the first client render agree (no EN-under-SW
 * first-paint split-brain); the client body reads it via
 * useLocale(initialLocale).
 */
export default async function FleetMaintenancePage() {
  const locale = await readLocaleFromServerCookies();
  return <MaintenancePageBody initialLocale={locale} />;
}
