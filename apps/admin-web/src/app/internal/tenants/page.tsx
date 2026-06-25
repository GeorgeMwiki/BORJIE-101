import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { TenantDirectory } from '@/components/internal/tenants/TenantDirectory';
import { NewTenantForm } from '@/components/internal/tenants/NewTenantForm';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('tenants')!;

export default async function TenantDirectoryPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell
      screen={SCREEN}
      // The "New tenant" primary action is now LIVE: NewTenantForm posts to the
      // real `POST /api/v1/mining/internal/tenants` route (SUPER_ADMIN/ADMIN
      // gated upstream) and refreshes the directory on success. It replaces the
      // permanently-disabled placeholder button.
      actions={<NewTenantForm initialLocale={locale} />}
    >
      <TenantDirectory initialLocale={locale} />
    </ScreenShell>
  );
}
